import {
  doc,
  increment,
  runTransaction,
  serverTimestamp,
  type WithFieldValue,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getMonthId } from "@/utils/date";
import { calculateDistribution } from "@/utils/distribution";
import type { Month, MonthCaps } from "@/types/month";
import type { Distribution } from "@/types/transaction";
import type { User } from "@/types/user";

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

    if (userProfile.lastClosedMonth === currentMonthId) {
      return { prevMonthId: userProfile.lastClosedMonth };
    }

    const prevMonthId = userProfile.lastClosedMonth;
    const prevMonthRef = prevMonthId
      ? doc(db, "users", userId, "months", prevMonthId)
      : null;
    const prevMonthSnap = prevMonthRef
      ? await transaction.get(prevMonthRef)
      : null;

    const newMonthRef = doc(db, "users", userId, "months", currentMonthId);
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

    const month = monthSnap.data() as Month;
    if (month.closed) {
      throw new Error("No se puede modificar un mes cerrado");
    }
    if (
      month.incomeCount > 0 &&
      newDistribution.ahorro !== month.distribution.ahorro
    ) {
      throw new Error(
        "El % de Ahorro ya se aplicó este mes — se puede cambiar recién el próximo mes",
      );
    }

    const split = calculateDistribution(
      month.totalIncomeCents,
      newDistribution,
    );

    transaction.update(userRef, { distribution: newDistribution });
    transaction.update(monthRef, {
      distribution: newDistribution,
      "capsCents.necesidad": split.necesidad,
      "capsCents.ocio": split.ocio,
    });
  });
}
