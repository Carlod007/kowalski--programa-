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
import {
  getMonthId,
  now,
  resolveTimeZone,
  shiftMonthId,
  toDateInputValue,
} from "@/utils/date";
import {
  applyClosingPolicy,
  getClosingPolicy,
} from "@/utils/closingPolicy";
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
  reachedCurrentMonth: boolean;
};

const VALID_MONTH_ID_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

type MonthClosePlan = {
  remainders: ReturnType<typeof getMonthRemainders>;
  destinations: ReturnType<typeof applyClosingPolicy>;
};

/**
 * Netea primero (F1/F5) y después aplica la política elegida. Así una política
 * nunca puede convertir un déficit en sobrante ni barrer dinero prestado.
 */
function planMonthClose(month: Month, user: User): MonthClosePlan {
  const remainders = getMonthRemainders(month);
  return {
    remainders,
    destinations: applyClosingPolicy(
      remainders,
      getClosingPolicy(user.closingPolicy),
    ),
  };
}

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
  nowDate: Date,
  onStepProgress?: (progress: StepProgress) => void,
  timeZoneOverride?: string,
): Promise<{
  closedMonthId: string | null;
  month: Month;
  currentMonthId: string;
}> {
  const userRef = doc(db, "users", userId);
  const userSnap = await transaction.get(userRef);
  if (!userSnap.exists()) {
    throw new Error(`checkAndCloseMonth: perfil ${userId} no existe`);
  }
  const userProfile = userSnap.data() as User;
  const timeZone = resolveTimeZone(timeZoneOverride ?? userProfile.timeZone);
  const currentMonthId = getMonthId(nowDate, timeZone);
  // Alias semántico: lastClosedMonth en Firestore representa el mes activo del cursor.
  const activeMonthId = userProfile.lastClosedMonth;
  const pendingCloseMonthId = userProfile.pendingCloseMonthId ?? null;
  const immediatePrevMonthId = shiftMonthId(currentMonthId, -1);
  const inGrace = isWithinGraceWindow(nowDate, timeZone);

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
      reachedCurrentMonth: nextOfPendingId >= currentMonthId,
    });

    let ownedInheritedNecesidadCents = 0;
    let ownedInheritedOcioCents = 0;
    let inheritedNecesidadCents = 0;
    let inheritedOcioCents = 0;
    let inheritedBorrowedCents: MonthCaps = { necesidad: 0, ocio: 0 };
    let closedMonthId: string | null = null;
    let savingsCreditedCents = 0;

    if (pendingMonthSnap.exists() && !pendingMonthSnap.data().closed) {
      const pendingMonth = pendingMonthSnap.data() as Month;
      const { remainders, destinations } = planMonthClose(
        pendingMonth,
        userProfile,
      );

      ownedInheritedNecesidadCents = destinations.necesidadToNextMonthCents;
      ownedInheritedOcioCents = destinations.ocioToNextMonthCents;
      inheritedNecesidadCents =
        ownedInheritedNecesidadCents + remainders.borrowed.necesidad;
      inheritedOcioCents =
        ownedInheritedOcioCents + remainders.borrowed.ocio;
      inheritedBorrowedCents = remainders.borrowed;
      savingsCreditedCents =
        destinations.necesidadSweptToAhorroCents +
        destinations.ocioToAhorroCents;

      const remainder: WithFieldValue<MonthRemainder> = {
        ocioToAhorroCents: destinations.ocioToAhorroCents,
        ocioToNextMonthCents: destinations.ocioToNextMonthCents,
        necesidadToNextMonthCents: destinations.necesidadToNextMonthCents,
        necesidadSweptToAhorroCents:
          destinations.necesidadSweptToAhorroCents,
        netDeficitCents: remainders.netDeficitCents,
        borrowedNecesidadCents: remainders.borrowed.necesidad,
        borrowedOcioCents: remainders.borrowed.ocio,
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
      (newMonth.capsCents as MonthCaps).ocio = inheritedOcioCents;
      newMonth.borrowedCapsCents = inheritedBorrowedCents;
      newMonth.inheritedNecesidadCents = ownedInheritedNecesidadCents;
      newMonth.inheritedOcioCents = ownedInheritedOcioCents;
      transaction.set(nextMonthRef, newMonth);
      resolvedMonth = newMonth as Month;
    } else {
      const existingMonth = nextMonthSnap.data() as Month;
      if (inheritedNecesidadCents > 0 || inheritedOcioCents > 0) {
        transaction.update(nextMonthRef, {
          "capsCents.necesidad": increment(inheritedNecesidadCents),
          "capsCents.ocio": increment(inheritedOcioCents),
          "borrowedCapsCents.necesidad": increment(
            inheritedBorrowedCents.necesidad,
          ),
          "borrowedCapsCents.ocio": increment(inheritedBorrowedCents.ocio),
          ...(ownedInheritedNecesidadCents > 0
            ? {
                inheritedNecesidadCents: increment(ownedInheritedNecesidadCents),
              }
            : {}),
          ...(ownedInheritedOcioCents > 0
            ? {
                inheritedOcioCents: increment(ownedInheritedOcioCents),
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
          ocio: existingMonth.capsCents.ocio + inheritedOcioCents,
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
        ...(ownedInheritedOcioCents > 0
          ? {
              inheritedOcioCents:
                (existingMonth.inheritedOcioCents ?? 0) +
                ownedInheritedOcioCents,
            }
          : {}),
      };
    }

    const userUpdate: Record<string, unknown> = {
      pendingCloseMonthId: null,
      ...(closedMonthId ? { unseenClosedMonthId: closedMonthId } : {}),
      ...(savingsCreditedCents > 0
        ? { savingsTotalCents: increment(savingsCreditedCents) }
        : {}),
    };
    const isActiveValid =
      typeof activeMonthId === "string" && VALID_MONTH_ID_RE.test(activeMonthId);
    if (!isActiveValid || activeMonthId < nextOfPendingId) {
      userUpdate.lastClosedMonth = nextOfPendingId;
    }
    transaction.update(userRef, userUpdate);

    return { closedMonthId, month: resolvedMonth, currentMonthId };
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
      reachedCurrentMonth: true,
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
        currentMonthId,
      };
    }
    const newMonth = buildEmptyMonth(userProfile.distribution);
    transaction.set(newMonthRef, newMonth);
    return {
      closedMonthId: null,
      month: newMonth as Month,
      currentMonthId,
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
    reachedCurrentMonth: targetMonthId >= currentMonthId,
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
  let ownedInheritedOcioCents = 0;
  let inheritedNecesidadCents = 0;
  let inheritedOcioCents = 0;
  let inheritedBorrowedCents: MonthCaps = { necesidad: 0, ocio: 0 };
  let closedMonthId: string | null = null;
  let savingsCreditedCents = 0;

  if (prevMonthOpen && !shouldKeepOpenInGrace && prevMonthRef && prevMonthSnap) {
    const prevMonth = prevMonthSnap.data() as Month;
    const { remainders, destinations } = planMonthClose(
      prevMonth,
      userProfile,
    );

    ownedInheritedNecesidadCents = destinations.necesidadToNextMonthCents;
    ownedInheritedOcioCents = destinations.ocioToNextMonthCents;
    inheritedNecesidadCents =
      ownedInheritedNecesidadCents + remainders.borrowed.necesidad;
    inheritedOcioCents = ownedInheritedOcioCents + remainders.borrowed.ocio;
    inheritedBorrowedCents = remainders.borrowed;
    savingsCreditedCents =
      destinations.necesidadSweptToAhorroCents +
      destinations.ocioToAhorroCents;

    const remainder: WithFieldValue<MonthRemainder> = {
      ocioToAhorroCents: destinations.ocioToAhorroCents,
      ocioToNextMonthCents: destinations.ocioToNextMonthCents,
      necesidadToNextMonthCents: destinations.necesidadToNextMonthCents,
      necesidadSweptToAhorroCents: destinations.necesidadSweptToAhorroCents,
      netDeficitCents: remainders.netDeficitCents,
      borrowedNecesidadCents: remainders.borrowed.necesidad,
      borrowedOcioCents: remainders.borrowed.ocio,
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
    (newMonth.capsCents as MonthCaps).ocio = inheritedOcioCents;
    newMonth.borrowedCapsCents = inheritedBorrowedCents;
    newMonth.inheritedNecesidadCents = ownedInheritedNecesidadCents;
    newMonth.inheritedOcioCents = ownedInheritedOcioCents;
    transaction.set(newMonthRef, newMonth);
    resolvedMonth = newMonth as Month;
  } else {
    const existingMonth = newMonthSnap.data() as Month;
    if (inheritedNecesidadCents > 0 || inheritedOcioCents > 0) {
      transaction.update(newMonthRef, {
        "capsCents.necesidad": increment(inheritedNecesidadCents),
        "capsCents.ocio": increment(inheritedOcioCents),
        "borrowedCapsCents.necesidad": increment(
          inheritedBorrowedCents.necesidad,
        ),
        "borrowedCapsCents.ocio": increment(inheritedBorrowedCents.ocio),
        ...(ownedInheritedNecesidadCents > 0
          ? {
              inheritedNecesidadCents: increment(ownedInheritedNecesidadCents),
            }
          : {}),
        ...(ownedInheritedOcioCents > 0
          ? {
              inheritedOcioCents: increment(ownedInheritedOcioCents),
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
        ocio: existingMonth.capsCents.ocio + inheritedOcioCents,
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
      ...(ownedInheritedOcioCents > 0
        ? {
            inheritedOcioCents:
              (existingMonth.inheritedOcioCents ?? 0) +
              ownedInheritedOcioCents,
          }
        : {}),
    };
  }

  const userUpdate: Record<string, unknown> = {
    lastClosedMonth: targetMonthId,
    ...(savingsCreditedCents > 0
      ? { savingsTotalCents: increment(savingsCreditedCents) }
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

  return { closedMonthId, month: resolvedMonth, currentMonthId };
}

export async function checkAndCloseMonth(
  userId: string,
  nowDate: Date = now(),
  timeZone?: string,
): Promise<{ closedMonthId: string | null }> {
  let lastClosedMonthId: string | null = null;
  let previousStepFromMonthId: string | null | undefined = undefined;

  while (true) {
    let stepProgress: StepProgress = {
      fromMonthId: null,
      targetMonthId: "",
      reachedCurrentMonth: false,
    };

    const { closedMonthId } = await runTransaction(
      db,
      async (transaction) => {
        const res = await applyMonthCloseAndEnsure(
          transaction,
          userId,
          nowDate,
          (progress) => {
            stepProgress = progress;
          },
          timeZone,
        );
        return {
          closedMonthId: res.closedMonthId,
        };
      },
    );

    if (closedMonthId) {
      lastClosedMonthId = closedMonthId;
    }

    if (stepProgress.reachedCurrentMonth) {
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
  nowDate: Date = now(),
  timeZone?: string,
): Promise<Month> {
  let latestMonth: Month;
  let previousStepFromMonthId: string | null | undefined = undefined;

  while (true) {
    let stepProgress: StepProgress = {
      fromMonthId: null,
      targetMonthId: "",
      reachedCurrentMonth: false,
    };

    const { closedMonthId, month } = await runTransaction(
      db,
      async (transaction) => {
        const result = await applyMonthCloseAndEnsure(
          transaction,
          userId,
          nowDate,
          (progress) => {
            stepProgress = progress;
          },
          timeZone,
        );
        return {
          closedMonthId: result.closedMonthId,
          month: result.month,
        };
      },
    );

    rememberMonthClosing(userId, closedMonthId);
    latestMonth = month;

    if (stepProgress.reachedCurrentMonth) {
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

    const { remainders, destinations } = planMonthClose(
      prevMonth,
      userProfile,
    );

    const effectiveResolution: DeficitResolution =
      remainders.netDeficitCents > 0 ? decision : "none";
    let coveredBySavingsCents = 0;
    let uncoveredDeficitCents = remainders.netDeficitCents;
    let carriedDeficitCents = 0;
    let savingsDelta =
      destinations.necesidadSweptToAhorroCents + destinations.ocioToAhorroCents;

    if (
      remainders.netDeficitCents > 0 &&
      effectiveResolution === "covered_by_savings"
    ) {
      const savingsTotal = userProfile.savingsTotalCents ?? 0;
      const unassigned = Math.max(
        0,
        getUnassignedCents(savingsTotal, userProfile.savingsGoals ?? []),
      );
      const maxCoverable = Math.max(0, Math.min(savingsTotal, unassigned));
      coveredBySavingsCents = Math.min(remainders.netDeficitCents, maxCoverable);
      uncoveredDeficitCents = remainders.netDeficitCents - coveredBySavingsCents;
      savingsDelta = -coveredBySavingsCents;
    } else if (
      remainders.netDeficitCents > 0 &&
      effectiveResolution === "carried_forward"
    ) {
      carriedDeficitCents = remainders.netDeficitCents;
      uncoveredDeficitCents = 0;
      savingsDelta = 0;
    } else if (remainders.netDeficitCents > 0) {
      savingsDelta = 0;
    }

    const remainder: WithFieldValue<MonthRemainder> = {
      ocioToAhorroCents: destinations.ocioToAhorroCents,
      ocioToNextMonthCents: destinations.ocioToNextMonthCents,
      necesidadToNextMonthCents: destinations.necesidadToNextMonthCents,
      necesidadSweptToAhorroCents: destinations.necesidadSweptToAhorroCents,
      netDeficitCents: remainders.netDeficitCents,
      borrowedNecesidadCents: remainders.borrowed.necesidad,
      borrowedOcioCents: remainders.borrowed.ocio,
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

    const ownedInheritedNecesidadCents = destinations.necesidadToNextMonthCents;
    const ownedInheritedOcioCents = destinations.ocioToNextMonthCents;
    const inheritedNecesidadCents =
      ownedInheritedNecesidadCents + remainders.borrowed.necesidad;
    const inheritedOcioCents =
      ownedInheritedOcioCents + remainders.borrowed.ocio;
    const inheritedBorrowedCents = remainders.borrowed;

    if (!nextMonthSnap.exists()) {
      const newMonth = buildEmptyMonth(userProfile.distribution);
      (newMonth.capsCents as MonthCaps).necesidad = inheritedNecesidadCents;
      (newMonth.capsCents as MonthCaps).ocio = inheritedOcioCents;
      newMonth.borrowedCapsCents = inheritedBorrowedCents;
      newMonth.inheritedNecesidadCents = ownedInheritedNecesidadCents;
      if (ownedInheritedOcioCents > 0) {
        newMonth.inheritedOcioCents = ownedInheritedOcioCents;
      }
      if (carriedDeficitCents > 0) {
        newMonth.carriedDeficitCents = carriedDeficitCents;
      }
      transaction.set(nextMonthRef, newMonth);
    } else {
      const nextMonthUpdate: Record<string, unknown> = {};
      if (inheritedNecesidadCents > 0 || inheritedOcioCents > 0) {
        nextMonthUpdate["capsCents.necesidad"] = increment(
          inheritedNecesidadCents,
        );
        nextMonthUpdate["capsCents.ocio"] = increment(
          inheritedOcioCents,
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
        if (ownedInheritedOcioCents > 0) {
          nextMonthUpdate.inheritedOcioCents = increment(
            ownedInheritedOcioCents,
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
