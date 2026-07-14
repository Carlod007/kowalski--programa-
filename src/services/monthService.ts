import {
  doc,
  getDoc,
  increment,
  runTransaction,
  serverTimestamp,
  type WithFieldValue,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getMonthId, shiftMonthId } from "@/utils/date";
import { calculateDistribution } from "@/utils/distribution";
import type { Month, MonthRemainder } from "@/types/month";
import type { Distribution, IncomeTransaction } from "@/types/transaction";
import type { User } from "@/types/user";

function buildEmptyMonth(distribution: Distribution): WithFieldValue<Month> {
  return {
    totalIncomeCents: 0,
    distribution,
    capsCents: { necesidad: 0, ocio: 0, ahorro: 0 },
    spentCents: { necesidad: 0, ocio: 0, ahorro: 0 },
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

    if (
      prevMonthRef &&
      prevMonthSnap &&
      prevMonthSnap.exists() &&
      !prevMonthSnap.data().closed
    ) {
      transaction.update(prevMonthRef, { closed: true });
    }

    if (!newMonthSnap.exists()) {
      transaction.set(newMonthRef, buildEmptyMonth(userProfile.distribution));
    }

    transaction.update(userRef, { lastClosedMonth: currentMonthId });

    return { prevMonthId };
  });

  return result;
}

export async function resolveMonthRemainder(
  userId: string,
  prevMonthId: string,
  newMonthId: string,
  decision: {
    remainderDestination?: "ahorro" | "next_month";
    newDistribution?: Distribution;
  },
): Promise<void> {
  const userRef = doc(db, "users", userId);
  const prevMonthRef = doc(db, "users", userId, "months", prevMonthId);
  const newMonthRef = doc(db, "users", userId, "months", newMonthId);

  await runTransaction(db, async (transaction) => {
    const [userSnap, prevMonthSnap, newMonthSnap] = await Promise.all([
      transaction.get(userRef),
      transaction.get(prevMonthRef),
      transaction.get(newMonthRef),
    ]);

    if (!userSnap.exists()) {
      throw new Error(`resolveMonthRemainder: perfil ${userId} no existe`);
    }
    if (!prevMonthSnap.exists()) {
      throw new Error(
        `resolveMonthRemainder: mes anterior ${prevMonthId} no existe`,
      );
    }
    if (!newMonthSnap.exists()) {
      throw new Error(
        `resolveMonthRemainder: mes nuevo ${newMonthId} no existe`,
      );
    }

    const prevMonth = prevMonthSnap.data() as Month;

    if (prevMonth.remainder !== undefined) return;

    const newMonth = newMonthSnap.data() as Month;

    const totalSpent =
      prevMonth.spentCents.necesidad +
      prevMonth.spentCents.ocio +
      prevMonth.spentCents.ahorro;
    const netCents = prevMonth.totalIncomeCents - totalSpent;

    const distributionFinal =
      decision.newDistribution ?? newMonth.distribution;

    if (decision.newDistribution) {
      transaction.update(userRef, { distribution: decision.newDistribution });
      transaction.update(newMonthRef, { distribution: decision.newDistribution });
    }

    let remainder: MonthRemainder;

    if (netCents <= 0) {
      remainder = {
        destination: "forgiven",
        amountCents: netCents,
      };
    } else if (!decision.remainderDestination) {
      throw new Error(
        `resolveMonthRemainder: netCents=${netCents} pero remainderDestination no definido`,
      );
    } else if (decision.remainderDestination === "ahorro") {
      remainder = { destination: "ahorro", amountCents: netCents };
      transaction.update(newMonthRef, {
        "capsCents.ahorro": increment(netCents),
      });
    } else {
      remainder = { destination: "next_month", amountCents: netCents };

      const split = calculateDistribution(netCents, distributionFinal);
      const txId = crypto.randomUUID();
      const txRef = doc(
        db,
        "users",
        userId,
        "months",
        newMonthId,
        "transactions",
        txId,
      );

      const tx: WithFieldValue<IncomeTransaction> = {
        type: "income",
        source: "Remanente mes anterior",
        transactionDate: `${newMonthId}-01`,
        amountCents: netCents,
        distribution: distributionFinal,
        serverDate: serverTimestamp(),
        localDate: new Date().toISOString(),
      };
      transaction.set(txRef, tx);

      transaction.update(newMonthRef, {
        totalIncomeCents: increment(netCents),
        incomeCount: increment(1),
        "capsCents.necesidad": increment(split.necesidad),
        "capsCents.ocio": increment(split.ocio),
        "capsCents.ahorro": increment(split.ahorro),
      });
    }

    transaction.update(prevMonthRef, { remainder });
  });
}

export async function isRemainderPending(
  userId: string,
): Promise<{ pending: boolean; prevMonthId: string | null }> {
  const prevMonthId = shiftMonthId(getMonthId(), -1);
  const monthSnap = await getDoc(
    doc(db, "users", userId, "months", prevMonthId),
  );
  if (!monthSnap.exists()) return { pending: false, prevMonthId: null };
  const month = monthSnap.data() as Month;
  const pending = month.closed && month.remainder === undefined;
  return { pending, prevMonthId: pending ? prevMonthId : null };
}
