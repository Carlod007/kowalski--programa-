import { collection, doc, query, where, onSnapshot, type Unsubscribe } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { shiftMonthId } from "@/utils/date";
import { CAP_CATEGORY_ORDER, CATEGORY_META } from "@/utils/category";
import type { Month, MonthCaps } from "@/types/month";
import type { Category, ExpenseTransaction } from "@/types/transaction";

const CHART_COLORS: Record<Category, string> = {
  necesidad: "#f59e0b",
  ocio: "#3b82f6",
  ahorro: "#14b8a6",
};

export function formatCategoryBreakdown(spentCents: MonthCaps): {
  category: Category;
  label: string;
  value: number;
  color: string;
}[] {
  return CAP_CATEGORY_ORDER.map((category) => ({
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

/**
 * Agrega lo que reciba, sin excluir categorías: quién llama decide qué mirar.
 * Antes descartaba ahorro acá adentro, y eso dejaba vacía la pestaña de Ahorro
 * aunque los datos existieran.
 */
export function computeTopSubcategories(
  txs: ExpenseTransaction[],
  limit: number,
): { category: Category; subcategory: string; totalCents: number }[] {
  const map = new Map<string, { category: Category; subcategory: string; totalCents: number }>();
  for (const tx of txs) {
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

/** Igual que computeTopSubcategories: no excluye nada por su cuenta. */
export function computeTopPaymentMethods(
  txs: ExpenseTransaction[],
  limit: number,
): { paymentMethod: string; totalCents: number }[] {
  const map = new Map<string, number>();
  for (const tx of txs) {
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

/**
 * Ambas barras miran el mismo universo: el presupuesto que se repartió y el
 * gasto contra sus topes. Los movimientos de ahorro quedan fuera de las dos,
 * porque sumarlos solo de un lado daría una comparación falsa.
 */
export function watchTrailingMonths(
  userId: string,
  endMonthId: string,
  maxCount: number,
  onData: (months: TrailingMonth[]) => void,
): Unsubscribe {
  const candidateIds: string[] = [];
  for (let i = maxCount - 1; i >= 0; i--) {
    candidateIds.push(shiftMonthId(endMonthId, -i));
  }

  const byId = new Map<string, TrailingMonth>();
  const reported = new Set<string>();

  const unsubs = candidateIds.map((id) =>
    onSnapshot(doc(db, "users", userId, "months", id), (snap) => {
      if (snap.exists()) {
        const month = snap.data() as Month;
        byId.set(id, {
          monthId: id,
          totalIncomeCents: month.totalIncomeCents,
          expenseCents: month.spentCents.necesidad + month.spentCents.ocio,
        });
      } else {
        byId.delete(id);
      }

      // Se espera a que todos los meses respondan una vez para no dibujar el
      // gráfico a medias en el primer render.
      reported.add(id);
      if (reported.size < candidateIds.length) return;

      onData(
        candidateIds
          .map((candidate) => byId.get(candidate))
          .filter((m): m is TrailingMonth => m !== undefined),
      );
    }),
  );

  return () => unsubs.forEach((unsub) => unsub());
}
