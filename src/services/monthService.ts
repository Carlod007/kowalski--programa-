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
import { calculateDistribution } from "@/utils/distribution";
import { getUnassignedCents } from "@/utils/savings";
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

export async function getOrCreateMonth(
  userId: string,
  monthId: string,
): Promise<Month> {
  const monthRef = doc(db, "users", userId, "months", monthId);
  const userRef = doc(db, "users", userId);

  return runTransaction(db, async (transaction) => {
    const monthSnap = await transaction.get(monthRef);
    if (monthSnap.exists()) {
      return monthSnap.data() as Month;
    }
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists()) {
      throw new Error(`getOrCreateMonth: perfil ${userId} no existe`);
    }
    const { distribution } = userSnap.data() as User;
    const newMonth = buildEmptyMonth(distribution);
    transaction.set(monthRef, newMonth);
    return newMonth as Month;
  });
}

export async function checkAndCloseMonth(
  userId: string,
): Promise<{ prevMonthId: string | null }> {
  const currentMonthId = getMonthId();
  const userRef = doc(db, "users", userId);

  const result = await runTransaction(db, async (transaction) => {
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
        syncDistributionIfUnused(
          transaction,
          newMonthRef,
          currentSnap.data() as Month,
          userProfile.distribution,
        );
      }
      return { prevMonthId: userProfile.lastClosedMonth };
    }

    const prevMonthId = userProfile.lastClosedMonth;
    const prevMonthRef = prevMonthId
      ? doc(db, "users", userId, "months", prevMonthId)
      : null;
    const prevMonthSnap = prevMonthRef
      ? await transaction.get(prevMonthRef)
      : null;

    const newMonthSnap = await transaction.get(newMonthRef);

    let inheritedNecesidadCents = 0;

    if (
      prevMonthRef &&
      prevMonthSnap &&
      prevMonthSnap.exists() &&
      !prevMonthSnap.data().closed
    ) {
      const prevMonth = prevMonthSnap.data() as Month;

      const excedenteNecesidad = Math.max(
        0,
        prevMonth.capsCents.necesidad - prevMonth.spentCents.necesidad,
      );
      const excedenteOcio = Math.max(
        0,
        prevMonth.capsCents.ocio - prevMonth.spentCents.ocio,
      );

      inheritedNecesidadCents = excedenteNecesidad;

      transaction.update(prevMonthRef, {
        closed: true,
        remainder: { ocioToAhorroCents: excedenteOcio },
      });

      if (excedenteOcio > 0) {
        transaction.update(userRef, {
          savingsTotalCents: increment(excedenteOcio),
        });
      }
    }

    if (!newMonthSnap.exists()) {
      const newMonth = buildEmptyMonth(userProfile.distribution);
      (newMonth.capsCents as MonthCaps).necesidad = inheritedNecesidadCents;
      transaction.set(newMonthRef, newMonth);
    } else {
      syncDistributionIfUnused(
        transaction,
        newMonthRef,
        newMonthSnap.data() as Month,
        userProfile.distribution,
      );
    }

    transaction.update(userRef, { lastClosedMonth: currentMonthId });

    return { prevMonthId };
  });

  return result;
}

export async function registerIncomeSplit(
  userId: string,
  monthId: string,
  incomeCents: number,
  distribution: Distribution,
): Promise<{ necesidadCents: number; ocioCents: number; ahorroCents: number }> {
  const split = calculateDistribution(incomeCents, distribution);
  const userRef = doc(db, "users", userId);
  const monthRef = doc(db, "users", userId, "months", monthId);

  await runTransaction(db, async (transaction) => {
    const monthSnap = await transaction.get(monthRef);
    if (!monthSnap.exists()) {
      throw new Error(`registerIncomeSplit: mes ${monthId} no existe`);
    }
    if (monthSnap.data().closed) {
      throw new Error("No se puede modificar un mes cerrado");
    }

    transaction.update(monthRef, {
      totalIncomeCents: increment(incomeCents),
      incomeCount: increment(1),
      "capsCents.necesidad": increment(split.necesidad),
      "capsCents.ocio": increment(split.ocio),
      ahorroContributedCents: increment(split.ahorro),
    });
    transaction.update(userRef, {
      savingsTotalCents: increment(split.ahorro),
    });
  });

  return {
    necesidadCents: split.necesidad,
    ocioCents: split.ocio,
    ahorroCents: split.ahorro,
  };
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
      const disponible = month.capsCents[origin] - month.spentCents[origin];
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
