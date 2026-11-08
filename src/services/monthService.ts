import {
  collection,
  doc,
  increment,
  runTransaction,
  serverTimestamp,
  type DocumentReference,
  type Transaction,
  type WithFieldValue,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getMonthId, shiftMonthId, toDateInputValue } from "@/utils/date";
import {
  distributionsEqual,
  isValidDistributionPercentage,
} from "@/utils/distribution";
import {
  markMonthClosingSeen,
  rememberMonthClosing,
} from "@/utils/monthClosingNotices";
import { getUnassignedCents } from "@/utils/savings";
import { getMonthRemainders } from "@/utils/monthRemainders";
import { isWithinGraceWindow } from "@/utils/transactionTiming";
import type {
  DeficitResolution,
  Month,
  MonthCaps,
  MonthRemainder,
} from "@/types/month";
import type { Distribution } from "@/types/transaction";
import type { User } from "@/types/user";
import type { Movement } from "@/types/movement";

export type DistributionUpdateScope = "next_income" | "next_month";

export function hasDistributedIncomes(
  month: Pick<Month, "distributedIncomeCount" | "totalIncomeCents">,
): boolean {
  return (
    (month.distributedIncomeCount ?? (month.totalIncomeCents > 0 ? 1 : 0)) > 0
  );
}

function buildEmptyMonth(distribution: Distribution): WithFieldValue<Month> {
  return {
    totalIncomeCents: 0,
    distribution,
    capsCents: { necesidad: 0, ocio: 0 },
    spentCents: { necesidad: 0, ocio: 0 },
    borrowedCapsCents: { necesidad: 0, ocio: 0 },
    loanFundedSpentCents: { necesidad: 0, ocio: 0 },
    ahorroContributedCents: 0,
    incomeCount: 0,
    distributedIncomeCount: 0,
    closed: false,
    createdAt: serverTimestamp(),
  };
}

/**
 * El mes congela su distribución automática cuando ya hay ingresos repartidos
 * por porcentajes (los aportes directos a Ahorro no congelan los %). Mientras
 * no haya ingresos repartidos, si el perfil cambió se sincroniza el mes.
 */
function syncDistributionIfUnused(
  transaction: Transaction,
  monthRef: DocumentReference,
  month: Month,
  profileDistribution: Distribution,
): void {
  if (hasDistributedIncomes(month)) return;
  if (distributionsEqual(month.distribution, profileDistribution)) {
    return;
  }
  transaction.update(monthRef, { distribution: profileDistribution });
}

type StepProgress = {
  fromMonthId: string | null;
  targetMonthId: string;
};

const VALID_MONTH_ID_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Ejecuta un paso atómico de cierre y apertura hacia `currentMonthId`.
 *
 * Nota sobre `userProfile.lastClosedMonth`:
 * En Firestore se mantiene el nombre físico `lastClosedMonth` por compatibilidad
 * con documentos y reglas existentes, pero en realidad almacena el cursor del
 * mes activo (`activeMonthId`).
 *
 * En F5:
 * - Si existe `pendingCloseMonthId` abierto cuya ventana de gracia ya venció
 *   (`pendingCloseMonthId < shiftMonthId(currentMonthId, -1)` o `!isWithinGraceWindow(now)`),
 *   se cierra primero con `deficitResolution: "none"` y se propagan sus remanentes
 *   al mes siguiente (`shiftMonthId(pendingCloseMonthId, 1)`).
 * - Al avanzar del mes inmediato anterior (`shiftMonthId(currentMonthId, -1)`) a
 *   `currentMonthId` dentro de los 3 días de gracia (`isWithinGraceWindow(now)`),
 *   se crea `months/{currentMonthId}` para operar de inmediato y se deja el mes
 *   anterior abierto con `pendingCloseMonthId = prevMonthId`.
 * - Fuera de la ventana de gracia (día 4+) o en cierres multi-mes de meses más
 *   antiguos, se cierra automáticamente con `deficitResolution: "none"`.
 */
async function applyMonthCloseAndEnsure(
  transaction: Transaction,
  userId: string,
  currentMonthId: string,
  now: Date,
  onStepProgress?: (progress: StepProgress) => void,
): Promise<{ closedMonthId: string | null; month: Month }> {
  const userRef = doc(db, "users", userId);
  const userSnap = await transaction.get(userRef);
  if (!userSnap.exists()) {
    throw new Error(`checkAndCloseMonth: perfil ${userId} no existe`);
  }
  const userProfile = userSnap.data() as User;
  // Alias semántico: lastClosedMonth en Firestore representa el mes activo del cursor.
  const activeMonthId = userProfile.lastClosedMonth;
  const pendingCloseMonthId = userProfile.pendingCloseMonthId ?? null;
  const immediatePrevMonthId = shiftMonthId(currentMonthId, -1);
  const inGrace = isWithinGraceWindow(now);

  const hasValidPendingClose =
    typeof pendingCloseMonthId === "string" &&
    VALID_MONTH_ID_RE.test(pendingCloseMonthId) &&
    pendingCloseMonthId < currentMonthId;
  const isPendingGraceExpired =
    hasValidPendingClose &&
    (pendingCloseMonthId < immediatePrevMonthId || !inGrace);

  // 1) Si había un mes en ventana de gracia y la gracia ya venció, cerrarlo
  // primero en orden cronológico antes de cualquier otro avance.
  if (isPendingGraceExpired && pendingCloseMonthId) {
    const nextOfPendingId = shiftMonthId(pendingCloseMonthId, 1);
    const pendingMonthRef = doc(
      db,
      "users",
      userId,
      "months",
      pendingCloseMonthId,
    );
    const nextMonthRef = doc(db, "users", userId, "months", nextOfPendingId);
    const [pendingMonthSnap, nextMonthSnap] = await Promise.all([
      transaction.get(pendingMonthRef),
      transaction.get(nextMonthRef),
    ]);

    onStepProgress?.({
      fromMonthId: pendingCloseMonthId,
      targetMonthId: nextOfPendingId,
    });

    let ownedInheritedNecesidadCents = 0;
    let inheritedNecesidadCents = 0;
    let inheritedBorrowedCents: MonthCaps = { necesidad: 0, ocio: 0 };
    let closedMonthId: string | null = null;
    let ocioCreditedCents = 0;

    if (pendingMonthSnap.exists() && !pendingMonthSnap.data().closed) {
      const pendingMonth = pendingMonthSnap.data() as Month;
      const {
        ocioToAhorroCents,
        necesidadToNextMonthCents,
        netDeficitCents,
        borrowed: borrowedRemainder,
      } = getMonthRemainders(pendingMonth);

      ownedInheritedNecesidadCents = necesidadToNextMonthCents;
      inheritedNecesidadCents =
        necesidadToNextMonthCents + borrowedRemainder.necesidad;
      inheritedBorrowedCents = borrowedRemainder;
      ocioCreditedCents = ocioToAhorroCents;

      const remainder: WithFieldValue<MonthRemainder> = {
        ocioToAhorroCents,
        necesidadToNextMonthCents,
        netDeficitCents,
        borrowedNecesidadCents: borrowedRemainder.necesidad,
        borrowedOcioCents: borrowedRemainder.ocio,
        deficitResolution: "none",
        closedAt: serverTimestamp(),
      };

      transaction.update(pendingMonthRef, {
        closed: true,
        remainder,
      });
      closedMonthId = pendingCloseMonthId;
    }

    let resolvedMonth: Month;
    if (!nextMonthSnap.exists()) {
      const newMonth = buildEmptyMonth(userProfile.distribution);
      (newMonth.capsCents as MonthCaps).necesidad = inheritedNecesidadCents;
      (newMonth.capsCents as MonthCaps).ocio = inheritedBorrowedCents.ocio;
      newMonth.borrowedCapsCents = inheritedBorrowedCents;
      newMonth.inheritedNecesidadCents = ownedInheritedNecesidadCents;
      transaction.set(nextMonthRef, newMonth);
      resolvedMonth = newMonth as Month;
    } else {
      const existingMonth = nextMonthSnap.data() as Month;
      if (inheritedNecesidadCents > 0 || inheritedBorrowedCents.ocio > 0) {
        transaction.update(nextMonthRef, {
          "capsCents.necesidad": increment(inheritedNecesidadCents),
          "capsCents.ocio": increment(inheritedBorrowedCents.ocio),
          "borrowedCapsCents.necesidad": increment(
            inheritedBorrowedCents.necesidad,
          ),
          "borrowedCapsCents.ocio": increment(inheritedBorrowedCents.ocio),
          ...(ownedInheritedNecesidadCents > 0
            ? {
                inheritedNecesidadCents: increment(ownedInheritedNecesidadCents),
              }
            : {}),
        });
      }
      syncDistributionIfUnused(
        transaction,
        nextMonthRef,
        existingMonth,
        userProfile.distribution,
      );
      resolvedMonth = {
        ...existingMonth,
        distribution: !hasDistributedIncomes(existingMonth)
          ? userProfile.distribution
          : existingMonth.distribution,
        capsCents: {
          necesidad:
            existingMonth.capsCents.necesidad + inheritedNecesidadCents,
          ocio: existingMonth.capsCents.ocio + inheritedBorrowedCents.ocio,
        },
        borrowedCapsCents: {
          necesidad:
            (existingMonth.borrowedCapsCents?.necesidad ?? 0) +
            inheritedBorrowedCents.necesidad,
          ocio:
            (existingMonth.borrowedCapsCents?.ocio ?? 0) +
            inheritedBorrowedCents.ocio,
        },
        ...(ownedInheritedNecesidadCents > 0
          ? {
              inheritedNecesidadCents:
                (existingMonth.inheritedNecesidadCents ?? 0) +
                ownedInheritedNecesidadCents,
            }
          : {}),
      };
    }

    const userUpdate: Record<string, unknown> = {
      pendingCloseMonthId: null,
      ...(closedMonthId ? { unseenClosedMonthId: closedMonthId } : {}),
      ...(ocioCreditedCents > 0
        ? { savingsTotalCents: increment(ocioCreditedCents) }
        : {}),
    };
    const isActiveValid =
      typeof activeMonthId === "string" && VALID_MONTH_ID_RE.test(activeMonthId);
    if (!isActiveValid || activeMonthId < nextOfPendingId) {
      userUpdate.lastClosedMonth = nextOfPendingId;
    }
    transaction.update(userRef, userUpdate);

    return { closedMonthId, month: resolvedMonth };
  }

  // La sincronización va antes de la salida temprana: los meses ya creados
  // con un reparto desactualizado no vuelven a pasar por la creación, y sin
  // esto nunca se corregirían.
  if (activeMonthId === currentMonthId) {
    const newMonthRef = doc(db, "users", userId, "months", currentMonthId);
    const currentSnap = await transaction.get(newMonthRef);
    onStepProgress?.({
      fromMonthId: activeMonthId,
      targetMonthId: currentMonthId,
    });
    if (currentSnap.exists()) {
      const currentMonth = currentSnap.data() as Month;
      syncDistributionIfUnused(
        transaction,
        newMonthRef,
        currentMonth,
        userProfile.distribution,
      );
      return {
        closedMonthId: null,
        month: !hasDistributedIncomes(currentMonth)
          ? { ...currentMonth, distribution: userProfile.distribution }
          : currentMonth,
      };
    }
    const newMonth = buildEmptyMonth(userProfile.distribution);
    transaction.set(newMonthRef, newMonth);
    return {
      closedMonthId: null,
      month: newMonth as Month,
    };
  }

  const isValidMonthId =
    typeof activeMonthId === "string" && VALID_MONTH_ID_RE.test(activeMonthId);
  const targetMonthId =
    isValidMonthId && activeMonthId < currentMonthId
      ? shiftMonthId(activeMonthId, 1)
      : currentMonthId;

  onStepProgress?.({
    fromMonthId: activeMonthId ?? null,
    targetMonthId,
  });

  const prevMonthId = activeMonthId;
  const prevMonthRef = prevMonthId
    ? doc(db, "users", userId, "months", prevMonthId)
    : null;
  const newMonthRef = doc(db, "users", userId, "months", targetMonthId);

  const [prevMonthSnap, newMonthSnap] = await Promise.all([
    prevMonthRef ? transaction.get(prevMonthRef) : Promise.resolve(null),
    transaction.get(newMonthRef),
  ]);

  const prevMonthOpen = Boolean(
    prevMonthRef &&
      prevMonthSnap &&
      prevMonthSnap.exists() &&
      !prevMonthSnap.data().closed,
  );
  const shouldKeepOpenInGrace =
    prevMonthOpen &&
    prevMonthId === immediatePrevMonthId &&
    targetMonthId === currentMonthId &&
    inGrace;

  let ownedInheritedNecesidadCents = 0;
  let inheritedNecesidadCents = 0;
  let inheritedBorrowedCents: MonthCaps = { necesidad: 0, ocio: 0 };
  let closedMonthId: string | null = null;
  let ocioCreditedCents = 0;

  if (prevMonthOpen && !shouldKeepOpenInGrace && prevMonthRef && prevMonthSnap) {
    const prevMonth = prevMonthSnap.data() as Month;

    const {
      ocioToAhorroCents,
      necesidadToNextMonthCents,
      netDeficitCents,
      borrowed: borrowedRemainder,
    } = getMonthRemainders(prevMonth);

    ownedInheritedNecesidadCents = necesidadToNextMonthCents;
    inheritedNecesidadCents =
      necesidadToNextMonthCents + borrowedRemainder.necesidad;
    inheritedBorrowedCents = borrowedRemainder;
    ocioCreditedCents = ocioToAhorroCents;

    const remainder: WithFieldValue<MonthRemainder> = {
      ocioToAhorroCents,
      necesidadToNextMonthCents,
      netDeficitCents,
      borrowedNecesidadCents: borrowedRemainder.necesidad,
      borrowedOcioCents: borrowedRemainder.ocio,
      deficitResolution: "none",
      closedAt: serverTimestamp(),
    };

    transaction.update(prevMonthRef, {
      closed: true,
      remainder,
    });
    closedMonthId = prevMonthId;
  }

  let resolvedMonth: Month;

  if (!newMonthSnap.exists()) {
    const newMonth = buildEmptyMonth(userProfile.distribution);
    (newMonth.capsCents as MonthCaps).necesidad = inheritedNecesidadCents;
    (newMonth.capsCents as MonthCaps).ocio = inheritedBorrowedCents.ocio;
    newMonth.borrowedCapsCents = inheritedBorrowedCents;
    newMonth.inheritedNecesidadCents = ownedInheritedNecesidadCents;
    transaction.set(newMonthRef, newMonth);
    resolvedMonth = newMonth as Month;
  } else {
    const existingMonth = newMonthSnap.data() as Month;
    if (inheritedNecesidadCents > 0 || inheritedBorrowedCents.ocio > 0) {
      transaction.update(newMonthRef, {
        "capsCents.necesidad": increment(inheritedNecesidadCents),
        "capsCents.ocio": increment(inheritedBorrowedCents.ocio),
        "borrowedCapsCents.necesidad": increment(
          inheritedBorrowedCents.necesidad,
        ),
        "borrowedCapsCents.ocio": increment(inheritedBorrowedCents.ocio),
        ...(ownedInheritedNecesidadCents > 0
          ? {
              inheritedNecesidadCents: increment(ownedInheritedNecesidadCents),
            }
          : {}),
      });
    }
    syncDistributionIfUnused(
      transaction,
      newMonthRef,
      existingMonth,
      userProfile.distribution,
    );
    resolvedMonth = {
      ...existingMonth,
      distribution: !hasDistributedIncomes(existingMonth)
        ? userProfile.distribution
        : existingMonth.distribution,
      capsCents: {
        necesidad:
          existingMonth.capsCents.necesidad + inheritedNecesidadCents,
        ocio: existingMonth.capsCents.ocio + inheritedBorrowedCents.ocio,
      },
      borrowedCapsCents: {
        necesidad:
          (existingMonth.borrowedCapsCents?.necesidad ?? 0) +
          inheritedBorrowedCents.necesidad,
        ocio:
          (existingMonth.borrowedCapsCents?.ocio ?? 0) +
          inheritedBorrowedCents.ocio,
      },
      ...(ownedInheritedNecesidadCents > 0
        ? {
            inheritedNecesidadCents:
              (existingMonth.inheritedNecesidadCents ?? 0) +
              ownedInheritedNecesidadCents,
          }
        : {}),
    };
  }

  const userUpdate: Record<string, unknown> = {
    lastClosedMonth: targetMonthId,
    ...(ocioCreditedCents > 0
      ? { savingsTotalCents: increment(ocioCreditedCents) }
      : {}),
  };

  if (shouldKeepOpenInGrace && prevMonthId) {
    userUpdate.pendingCloseMonthId = prevMonthId;
  } else if (closedMonthId) {
    userUpdate.pendingCloseMonthId = null;
    userUpdate.unseenClosedMonthId = closedMonthId;
  } else if (userProfile.pendingCloseMonthId === prevMonthId && prevMonthId) {
    userUpdate.pendingCloseMonthId = null;
  }

  transaction.update(userRef, userUpdate);

  return { closedMonthId, month: resolvedMonth };
}

export async function checkAndCloseMonth(
  userId: string,
  now: Date = new Date(),
): Promise<{ closedMonthId: string | null }> {
  const currentMonthId = getMonthId(now);
  let lastClosedMonthId: string | null = null;
  let previousStepFromMonthId: string | null | undefined = undefined;

  while (true) {
    let stepProgress: StepProgress = {
      fromMonthId: null,
      targetMonthId: currentMonthId,
    };

    const { closedMonthId } = await runTransaction(db, async (transaction) => {
      const res = await applyMonthCloseAndEnsure(
        transaction,
        userId,
        currentMonthId,
        now,
        (progress) => {
          stepProgress = progress;
        },
      );
      return { closedMonthId: res.closedMonthId };
    });

    if (closedMonthId) {
      lastClosedMonthId = closedMonthId;
    }

    if (stepProgress.targetMonthId >= currentMonthId) {
      break;
    }
    if (
      previousStepFromMonthId !== undefined &&
      stepProgress.fromMonthId === previousStepFromMonthId
    ) {
      break;
    }
    previousStepFromMonthId = stepProgress.fromMonthId;
  }

  return { closedMonthId: lastClosedMonthId };
}

export async function ensureCurrentMonth(
  userId: string,
  now: Date = new Date(),
): Promise<Month> {
  const currentMonthId = getMonthId(now);
  let latestMonth: Month;
  let previousStepFromMonthId: string | null | undefined = undefined;

  while (true) {
    let stepProgress: StepProgress = {
      fromMonthId: null,
      targetMonthId: currentMonthId,
    };

    const { closedMonthId, month } = await runTransaction(
      db,
      async (transaction) =>
        applyMonthCloseAndEnsure(
          transaction,
          userId,
          currentMonthId,
          now,
          (progress) => {
            stepProgress = progress;
          },
        ),
    );

    rememberMonthClosing(userId, closedMonthId);
    latestMonth = month;

    if (stepProgress.targetMonthId >= currentMonthId) {
      break;
    }
    if (
      previousStepFromMonthId !== undefined &&
      stepProgress.fromMonthId === previousStepFromMonthId
    ) {
      break;
    }
    previousStepFromMonthId = stepProgress.fromMonthId;
  }

  return latestMonth!;
}

/**
 * Confirma el cierre de un mes abierto (`prevMonthId`) aplicando la lógica
 * neteada de F1 y la resolución de déficit elegida por el usuario:
 * - "covered_by_savings": descuenta de `savingsTotalCents` solo lo disponible
 *   sin asignar a metas (nunca deja ahorro negativo ni sobreasignado). Si no
 *   alcanza a cubrir todo el déficit, cubre hasta lo disponible y deja el resto
 *   registrado en `uncoveredDeficitCents`.
 * - "carried_forward": traslada el déficit neto al mes siguiente en
 *   `carriedDeficitCents` (reduciendo el disponible de Necesidad del mes nuevo).
 * - "none": solo registra el déficit en `remainder`.
 */
export async function confirmMonthClose(
  userId: string,
  prevMonthId: string,
  decision: DeficitResolution = "none",
): Promise<{
  closedMonthId: string;
  coveredBySavingsCents: number;
  uncoveredDeficitCents: number;
  carriedDeficitCents: number;
}> {
  if (!VALID_MONTH_ID_RE.test(prevMonthId)) {
    throw new Error(`confirmMonthClose: mes inválido ${prevMonthId}`);
  }
  if (
    decision !== "covered_by_savings" &&
    decision !== "carried_forward" &&
    decision !== "none"
  ) {
    throw new Error("confirmMonthClose: decisión de déficit inválida");
  }

  const nextMonthId = shiftMonthId(prevMonthId, 1);
  const userRef = doc(db, "users", userId);
  const prevMonthRef = doc(db, "users", userId, "months", prevMonthId);
  const nextMonthRef = doc(db, "users", userId, "months", nextMonthId);

  const result = await runTransaction(db, async (transaction) => {
    const [userSnap, prevMonthSnap, nextMonthSnap] = await Promise.all([
      transaction.get(userRef),
      transaction.get(prevMonthRef),
      transaction.get(nextMonthRef),
    ]);

    if (!userSnap.exists()) {
      throw new Error(`confirmMonthClose: perfil ${userId} no existe`);
    }
    if (!prevMonthSnap.exists()) {
      throw new Error(`confirmMonthClose: mes ${prevMonthId} no existe`);
    }

    const userProfile = userSnap.data() as User;
    const prevMonth = prevMonthSnap.data() as Month;

    if (prevMonth.closed) {
      throw new Error("El mes ya está cerrado");
    }

    const {
      ocioToAhorroCents,
      necesidadToNextMonthCents,
      netDeficitCents,
      borrowed: borrowedRemainder,
    } = getMonthRemainders(prevMonth);

    const effectiveResolution: DeficitResolution =
      netDeficitCents > 0 ? decision : "none";
    let coveredBySavingsCents = 0;
    let uncoveredDeficitCents = netDeficitCents;
    let carriedDeficitCents = 0;
    let savingsDelta = ocioToAhorroCents;

    if (netDeficitCents > 0 && effectiveResolution === "covered_by_savings") {
      const savingsTotal = userProfile.savingsTotalCents ?? 0;
      const unassigned = Math.max(
        0,
        getUnassignedCents(savingsTotal, userProfile.savingsGoals ?? []),
      );
      const maxCoverable = Math.max(0, Math.min(savingsTotal, unassigned));
      coveredBySavingsCents = Math.min(netDeficitCents, maxCoverable);
      uncoveredDeficitCents = netDeficitCents - coveredBySavingsCents;
      savingsDelta -= coveredBySavingsCents;
    } else if (
      netDeficitCents > 0 &&
      effectiveResolution === "carried_forward"
    ) {
      carriedDeficitCents = netDeficitCents;
      uncoveredDeficitCents = 0;
    }

    const remainder: WithFieldValue<MonthRemainder> = {
      ocioToAhorroCents,
      necesidadToNextMonthCents,
      netDeficitCents,
      borrowedNecesidadCents: borrowedRemainder.necesidad,
      borrowedOcioCents: borrowedRemainder.ocio,
      deficitResolution: effectiveResolution,
      ...(effectiveResolution === "covered_by_savings"
        ? {
            coveredBySavingsCents,
            uncoveredDeficitCents,
          }
        : {}),
      closedAt: serverTimestamp(),
    };

    transaction.update(prevMonthRef, {
      closed: true,
      remainder,
    });

    const ownedInheritedNecesidadCents = necesidadToNextMonthCents;
    const inheritedNecesidadCents =
      necesidadToNextMonthCents + borrowedRemainder.necesidad;
    const inheritedBorrowedCents = borrowedRemainder;

    if (!nextMonthSnap.exists()) {
      const newMonth = buildEmptyMonth(userProfile.distribution);
      (newMonth.capsCents as MonthCaps).necesidad = inheritedNecesidadCents;
      (newMonth.capsCents as MonthCaps).ocio = inheritedBorrowedCents.ocio;
      newMonth.borrowedCapsCents = inheritedBorrowedCents;
      newMonth.inheritedNecesidadCents = ownedInheritedNecesidadCents;
      if (carriedDeficitCents > 0) {
        newMonth.carriedDeficitCents = carriedDeficitCents;
      }
      transaction.set(nextMonthRef, newMonth);
    } else {
      const nextMonthUpdate: Record<string, unknown> = {};
      if (inheritedNecesidadCents > 0 || inheritedBorrowedCents.ocio > 0) {
        nextMonthUpdate["capsCents.necesidad"] = increment(
          inheritedNecesidadCents,
        );
        nextMonthUpdate["capsCents.ocio"] = increment(
          inheritedBorrowedCents.ocio,
        );
        nextMonthUpdate["borrowedCapsCents.necesidad"] = increment(
          inheritedBorrowedCents.necesidad,
        );
        nextMonthUpdate["borrowedCapsCents.ocio"] = increment(
          inheritedBorrowedCents.ocio,
        );
        if (ownedInheritedNecesidadCents > 0) {
          nextMonthUpdate.inheritedNecesidadCents = increment(
            ownedInheritedNecesidadCents,
          );
        }
      }
      if (carriedDeficitCents > 0) {
        nextMonthUpdate.carriedDeficitCents = increment(carriedDeficitCents);
      }
      if (Object.keys(nextMonthUpdate).length > 0) {
        transaction.update(nextMonthRef, nextMonthUpdate);
      }
    }

    const userUpdate: Record<string, unknown> = {
      pendingCloseMonthId: null,
      unseenClosedMonthId: prevMonthId,
    };
    const isActiveValid =
      typeof userProfile.lastClosedMonth === "string" &&
      VALID_MONTH_ID_RE.test(userProfile.lastClosedMonth);
    if (!isActiveValid || userProfile.lastClosedMonth! < nextMonthId) {
      userUpdate.lastClosedMonth = nextMonthId;
    }
    if (savingsDelta !== 0) {
      userUpdate.savingsTotalCents = increment(savingsDelta);
    }
    transaction.update(userRef, userUpdate);

    return {
      closedMonthId: prevMonthId,
      coveredBySavingsCents,
      uncoveredDeficitCents,
      carriedDeficitCents,
    };
  });

  rememberMonthClosing(userId, prevMonthId);
  return result;
}

/**
 * Marca el resumen de cierre de `monthId` como visto tanto en el espejo local
 * (`localStorage`) como en Firestore (`unseenClosedMonthId: null`), para que
 * no vuelva a mostrarse en otros dispositivos.
 */
export async function acknowledgeClosedMonthSummary(
  userId: string,
  monthId: string,
): Promise<void> {
  markMonthClosingSeen(userId, monthId);
  const userRef = doc(db, "users", userId);
  await runTransaction(db, async (transaction) => {
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists()) return;
    const profile = userSnap.data() as User;
    if (profile.unseenClosedMonthId === monthId) {
      transaction.update(userRef, { unseenClosedMonthId: null });
    }
  });
}

export async function updateDistributionNow(
  userId: string,
  newDistribution: Distribution,
  scope: DistributionUpdateScope = "next_income",
): Promise<void> {
  if (!isValidDistributionPercentage(newDistribution)) {
    throw new Error(
      "updateDistributionNow: la distribución debe tener enteros entre 0 y 100 que sumen 100",
    );
  }

  const currentMonthId = getMonthId();
  const userRef = doc(db, "users", userId);
  const monthRef = doc(db, "users", userId, "months", currentMonthId);

  await runTransaction(db, async (transaction) => {
    const [userSnap, monthSnap] = await Promise.all([
      transaction.get(userRef),
      transaction.get(monthRef),
    ]);

    if (!userSnap.exists()) {
      throw new Error(`updateDistributionNow: perfil ${userId} no existe`);
    }
    if (!monthSnap.exists()) {
      throw new Error(
        `updateDistributionNow: mes actual ${currentMonthId} no existe`,
      );
    }

    const month = monthSnap.data() as Month;
    transaction.update(userRef, { distribution: newDistribution });

    const shouldUpdateMonth =
      !month.closed &&
      (!hasDistributedIncomes(month) || scope === "next_income");

    if (
      shouldUpdateMonth &&
      !distributionsEqual(month.distribution, newDistribution)
    ) {
      transaction.update(monthRef, { distribution: newDistribution });
    }
  });
}

export async function moveSurplus(
  userId: string,
  monthId: string,
  amountCents: number,
  origin: "necesidad" | "ocio" | "ahorro",
  destination: "necesidad" | "ocio" | "ahorro",
  reason?: string,
): Promise<void> {
  if (amountCents <= 0) {
    throw new Error("El monto debe ser mayor a 0");
  }
  if (origin === destination) {
    throw new Error("El origen y el destino no pueden ser la misma categoría");
  }

  const userRef = doc(db, "users", userId);
  const monthRef = doc(db, "users", userId, "months", monthId);
  const movementRef = doc(
    collection(db, "users", userId, "months", monthId, "movements"),
  );

  await runTransaction(db, async (transaction) => {
    const [userSnap, monthSnap] = await Promise.all([
      transaction.get(userRef),
      transaction.get(monthRef),
    ]);

    if (!userSnap.exists()) {
      throw new Error(`moveSurplus: perfil ${userId} no existe`);
    }
    if (!monthSnap.exists()) {
      throw new Error(`moveSurplus: mes ${monthId} no existe`);
    }

    const month = monthSnap.data() as Month;
    const user = userSnap.data() as User;

    if (month.closed) {
      throw new Error("No se puede modificar un mes cerrado");
    }

    if (origin === "necesidad" || origin === "ocio") {
      const borrowedCap = month.borrowedCapsCents?.[origin] ?? 0;
      const loanFundedSpent = month.loanFundedSpentCents?.[origin] ?? 0;
      const carriedDeficit =
        origin === "necesidad" ? (month.carriedDeficitCents ?? 0) : 0;
      const disponible =
        month.capsCents[origin] -
        borrowedCap -
        (month.spentCents[origin] - loanFundedSpent) -
        carriedDeficit;
      if (amountCents > disponible) {
        const label = origin === "necesidad" ? "Necesidad" : "Ocio";
        throw new Error(`El monto supera el excedente disponible de ${label}`);
      }
    } else {
      // Sacar plata de Ahorro solo puede tocar lo que no está reservado para
      // una meta. Si se permitiera vaciar por debajo de lo asignado, las metas
      // quedarían prometiendo plata que ya no existe.
      const unassigned = getUnassignedCents(
        user.savingsTotalCents ?? 0,
        user.savingsGoals ?? [],
      );
      if (amountCents > unassigned) {
        throw new Error(
          "El monto supera tu ahorro sin asignar. Libera dinero de tus metas primero.",
        );
      }
    }

    const monthUpdate: Record<string, unknown> = {};
    let savingsTotalDelta = 0;

    if (origin === "necesidad" || origin === "ocio") {
      monthUpdate[`capsCents.${origin}`] = increment(-amountCents);
    } else {
      savingsTotalDelta -= amountCents;
      const currentContributed = month.ahorroContributedCents ?? 0;
      const revertibleContributed = Math.min(amountCents, currentContributed);
      if (revertibleContributed > 0) {
        monthUpdate.ahorroContributedCents = increment(-revertibleContributed);
      }
    }

    if (destination === "necesidad" || destination === "ocio") {
      monthUpdate[`capsCents.${destination}`] = increment(amountCents);
    } else {
      monthUpdate.ahorroContributedCents = increment(amountCents);
      savingsTotalDelta += amountCents;
    }

    transaction.update(monthRef, monthUpdate);
    if (savingsTotalDelta !== 0) {
      transaction.update(userRef, {
        savingsTotalCents: increment(savingsTotalDelta),
      });
    }

    const movement: WithFieldValue<Movement> = {
      userId,
      monthId,
      origin,
      destination,
      amountCents,
      transactionDate: toDateInputValue(),
      serverDate: serverTimestamp(),
      ...(reason ? { reason } : {}),
    };
    transaction.set(movementRef, movement);
  });
}
