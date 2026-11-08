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
import { getMonthId, toDateInputValue } from "@/utils/date";
import { rememberMonthClosing } from "@/utils/monthClosingNotices";
import { getUnassignedCents } from "@/utils/savings";
import { getMonthRemainders } from "@/utils/monthRemainders";
import type { Month, MonthCaps } from "@/types/month";
import type { Distribution } from "@/types/transaction";
import type { User } from "@/types/user";
import type { Movement } from "@/types/movement";

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
    closed: false,
    createdAt: serverTimestamp(),
  };
}

/**
 * El mes congela su distribución para que los topes ya repartidos no cambien
 * a mitad de camino. Pero mientras no haya ningún ingreso no hay nada
 * repartido que proteger, y un mes congelado con un valor que el usuario ya
 * cambió muestra un porcentaje distinto al de Ajustes. En ese caso se
 * sincroniza.
 */
function syncDistributionIfUnused(
  transaction: Transaction,
  monthRef: DocumentReference,
  month: Month,
  profileDistribution: Distribution,
): void {
  if (month.incomeCount !== 0) return;
  const current = month.distribution;
  if (
    current.necesidad === profileDistribution.necesidad &&
    current.ocio === profileDistribution.ocio &&
    current.ahorro === profileDistribution.ahorro
  ) {
    return;
  }
  transaction.update(monthRef, { distribution: profileDistribution });
}

async function applyMonthCloseAndEnsure(
  transaction: Transaction,
  userId: string,
  currentMonthId: string,
): Promise<{ closedMonthId: string | null; month: Month }> {
  const userRef = doc(db, "users", userId);
  const userSnap = await transaction.get(userRef);
  if (!userSnap.exists()) {
    throw new Error(`checkAndCloseMonth: perfil ${userId} no existe`);
  }
  const userProfile = userSnap.data() as User;
  const newMonthRef = doc(db, "users", userId, "months", currentMonthId);

  // La sincronización va antes de la salida temprana: los meses ya creados
  // con un reparto desactualizado no vuelven a pasar por la creación, y sin
  // esto nunca se corregirían.
  if (userProfile.lastClosedMonth === currentMonthId) {
    const currentSnap = await transaction.get(newMonthRef);
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
        month:
          currentMonth.incomeCount === 0
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

  const prevMonthId = userProfile.lastClosedMonth;
  const prevMonthRef = prevMonthId
    ? doc(db, "users", userId, "months", prevMonthId)
    : null;
  const prevMonthSnap = prevMonthRef
    ? await transaction.get(prevMonthRef)
    : null;

  const newMonthSnap = await transaction.get(newMonthRef);

  let ownedInheritedNecesidadCents = 0;
  let inheritedNecesidadCents = 0;
  let inheritedBorrowedCents: MonthCaps = { necesidad: 0, ocio: 0 };
  let closedMonthId: string | null = null;

  if (
    prevMonthRef &&
    prevMonthSnap &&
    prevMonthSnap.exists() &&
    !prevMonthSnap.data().closed
  ) {
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

    transaction.update(prevMonthRef, {
      closed: true,
      remainder: {
        ocioToAhorroCents,
        necesidadToNextMonthCents,
        netDeficitCents,
      },
    });
    closedMonthId = prevMonthId;

    if (ocioToAhorroCents > 0) {
      transaction.update(userRef, {
        savingsTotalCents: increment(ocioToAhorroCents),
      });
    }
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
      distribution:
        existingMonth.incomeCount === 0
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

  transaction.update(userRef, { lastClosedMonth: currentMonthId });

  return { closedMonthId, month: resolvedMonth };
}

export async function checkAndCloseMonth(
  userId: string,
  now: Date = new Date(),
): Promise<{ closedMonthId: string | null }> {
  const currentMonthId = getMonthId(now);
  return runTransaction(db, async (transaction) => {
    const { closedMonthId } = await applyMonthCloseAndEnsure(
      transaction,
      userId,
      currentMonthId,
    );
    return { closedMonthId };
  });
}

export async function ensureCurrentMonth(
  userId: string,
  now: Date = new Date(),
): Promise<Month> {
  const currentMonthId = getMonthId(now);
  const { closedMonthId, month } = await runTransaction(
    db,
    async (transaction) =>
      applyMonthCloseAndEnsure(transaction, userId, currentMonthId),
  );
  rememberMonthClosing(userId, closedMonthId);
  return month;
}

export async function updateDistributionNow(
  userId: string,
  newDistribution: Distribution,
): Promise<void> {
  const sum =
    newDistribution.necesidad + newDistribution.ocio + newDistribution.ahorro;
  if (sum !== 100) {
    throw new Error(
      `updateDistributionNow: la distribución debe sumar 100, recibido ${sum}`,
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

    transaction.update(userRef, { distribution: newDistribution });
    syncDistributionIfUnused(
      transaction,
      monthRef,
      monthSnap.data() as Month,
      newDistribution,
    );
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
      const disponible =
        month.capsCents[origin] -
        borrowedCap -
        (month.spentCents[origin] - loanFundedSpent);
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
