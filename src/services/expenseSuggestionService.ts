import {
  collection,
  documentId,
  getDocs,
  orderBy,
  query,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ExpenseTransaction } from "@/types/transaction";

export async function getRecentExpenseHistory(
  userId: string,
  monthLimit = 6,
): Promise<ExpenseTransaction[]> {
  const monthsQuery = query(
    collection(db, "users", userId, "months"),
    orderBy(documentId()),
  );
  const monthSnapshot = await getDocs(monthsQuery);
  const months = monthSnapshot.docs.slice(-monthLimit);
  const expenseSnapshots = await Promise.all(
    months.map((month) =>
      getDocs(collection(month.ref, "transactions")),
    ),
  );
  return expenseSnapshots.flatMap((snapshot) =>
    snapshot.docs
      .map((item) => item.data())
      .filter((item) => item.type === "expense") as ExpenseTransaction[],
  );
}
