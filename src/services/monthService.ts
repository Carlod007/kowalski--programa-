import {
  doc,
  runTransaction,
  serverTimestamp,
  type WithFieldValue,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getMonthId } from "@/utils/date";
import type { Month } from "@/types/month";
import type { Distribution } from "@/types/transaction";
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

export async function checkAndCloseMonth(userId: string): Promise<void> {
  const currentMonthId = getMonthId();
  const userRef = doc(db, "users", userId);

  await runTransaction(db, async (transaction) => {
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists()) {
      throw new Error(`checkAndCloseMonth: perfil ${userId} no existe`);
    }
    const userProfile = userSnap.data() as User;

    if (userProfile.lastClosedMonth === currentMonthId) {
      return;
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
  });
}
