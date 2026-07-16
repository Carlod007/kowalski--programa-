import { collection, doc, getDoc, query, where, onSnapshot, type Unsubscribe } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { shiftMonthId } from "@/utils/date";
import { CATEGORY_ORDER, CATEGORY_META } from "@/utils/category";
import type { Month } from "@/types/month";
import type { Category, Distribution, ExpenseTransaction } from "@/types/transaction";

const CHART_COLORS: Record<Category, string> = {
  necesidad: "#f59e0b",
  ocio: "#3b82f6",
  ahorro: "#14b8a6",
};

export function formatCategoryBreakdown(spentCents: Distribution): {
  category: Category;
  label: string;
  value: number;
  color: string;
}[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    label: CATEGORY_META[category].label,
    value: spentCents[category],
    color: CHART_COLORS[category],
  }));
}

export function getMonthExpenses(
  userId: string,
  monthId: string,
  onData: (txs: ExpenseTransaction[]) => void,
): Unsubscribe {
  const txRef = collection(db, "users", userId, "months", monthId, "transactions");
  const q = query(txRef, where("type", "==", "expense"));

  return onSnapshot(q, (snap) => {
    const txs = snap.docs.map((d) => d.data() as ExpenseTransaction);
    onData(txs);
  });
}

export function computeTopSubcategories(
  txs: ExpenseTransaction[],
  limit: number,
): { category: Category; subcategory: string; totalCents: number }[] {
  const filtered = txs.filter((tx) => tx.category !== "ahorro");

  const map = new Map<string, { category: Category; subcategory: string; totalCents: number }>();
  for (const tx of filtered) {
    const key = `${tx.category}::${tx.subcategory}`;
    const existing = map.get(key);
    if (existing) {
      existing.totalCents += tx.amountCents;
    } else {
      map.set(key, { category: tx.category, subcategory: tx.subcategory, totalCents: tx.amountCents });
    }
  }

  return Array.from(map.values())
    .sort((a, b) => b.totalCents - a.totalCents)
    .slice(0, limit);
}

export function computeTopPaymentMethods(
  txs: ExpenseTransaction[],
  limit: number,
): { paymentMethod: string; totalCents: number }[] {
  const filtered = txs.filter((tx) => tx.category !== "ahorro");

  const map = new Map<string, number>();
  for (const tx of filtered) {
    map.set(tx.paymentMethod, (map.get(tx.paymentMethod) ?? 0) + tx.amountCents);
  }

  return Array.from(map.entries())
    .map(([paymentMethod, totalCents]) => ({ paymentMethod, totalCents }))
    .sort((a, b) => b.totalCents - a.totalCents)
    .slice(0, limit);
}

export type TrailingMonth = {
  monthId: string;
  totalIncomeCents: number;
  expenseCents: number;
};

export async function getTrailingMonths(
  userId: string,
  endMonthId: string,
  maxCount: number,
): Promise<TrailingMonth[]> {
  const candidateIds: string[] = [];
  for (let i = maxCount - 1; i >= 0; i--) {
    candidateIds.push(shiftMonthId(endMonthId, -i));
  }

  const snaps = await Promise.all(
    candidateIds.map((id) => getDoc(doc(db, "users", userId, "months", id))),
  );

  const result: TrailingMonth[] = [];
  for (let i = 0; i < snaps.length; i++) {
    const snap = snaps[i];
    if (!snap.exists()) continue;
    const month = snap.data() as Month;
    result.push({
      monthId: candidateIds[i],
      totalIncomeCents: month.totalIncomeCents,
      expenseCents: month.spentCents.necesidad + month.spentCents.ocio,
    });
  }
  return result;
}
