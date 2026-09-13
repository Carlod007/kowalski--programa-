import { collection, doc, query, where, onSnapshot, type Unsubscribe } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { shiftMonthId } from "@/utils/date";
import { CAP_CATEGORY_ORDER, CATEGORY_META } from "@/utils/category";
import { getConsumptionByCategory } from "@/utils/expenseClassification";
import type { Month, MonthCaps } from "@/types/month";
import type { Category, ExpenseTransaction } from "@/types/transaction";
import type {
  CreditCardPayment,
  CreditCardPaymentWithId,
} from "@/types/creditCard";

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
  onError?: (error: Error) => void,
): Unsubscribe {
  const txRef = collection(db, "users", userId, "months", monthId, "transactions");
  const q = query(txRef, where("type", "==", "expense"));

  return onSnapshot(
    q,
    (snap) => {
      const txs = snap.docs.map((d) => d.data() as ExpenseTransaction);
      onData(txs);
    },
    (error) => onError?.(error),
  );
}

/** Lee pagos de todas las tarjetas del usuario para un mes, sin convertirlos
 * en transacciones de gasto ni modificar la contabilidad existente. */
export function watchCreditCardPaymentsForMonth(
  userId: string,
  monthId: string,
  onData: (payments: CreditCardPaymentWithId[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const cardsRef = collection(db, "users", userId, "creditCards");
  let paymentUnsubs: Unsubscribe[] = [];
  let generation = 0;

  const cardsUnsub = onSnapshot(
    cardsRef,
    (cardsSnapshot) => {
      generation += 1;
      const currentGeneration = generation;
      paymentUnsubs.forEach((unsubscribe) => unsubscribe());
      paymentUnsubs = [];

      const cardIds = cardsSnapshot.docs.map((card) => card.id);
      if (cardIds.length === 0) {
        onData([]);
        return;
      }

      const paymentsByCard = new Map<string, CreditCardPaymentWithId[]>();
      const reported = new Set<string>();
      const startDate = `${monthId}-01`;
      const nextMonthDate = `${shiftMonthId(monthId, 1)}-01`;

      const emitWhenReady = () => {
        if (
          currentGeneration !== generation ||
          reported.size < cardIds.length
        ) {
          return;
        }
        onData(cardIds.flatMap((cardId) => paymentsByCard.get(cardId) ?? []));
      };

      for (const cardId of cardIds) {
        const paymentsQuery = query(
          collection(db, "users", userId, "creditCards", cardId, "payments"),
          where("paymentDate", ">=", startDate),
          where("paymentDate", "<", nextMonthDate),
        );
        paymentUnsubs.push(
          onSnapshot(
            paymentsQuery,
            (paymentsSnapshot) => {
              if (currentGeneration !== generation) return;
              paymentsByCard.set(
                cardId,
                paymentsSnapshot.docs.map((payment) => ({
                  ...(payment.data() as CreditCardPayment),
                  id: payment.id,
                })),
              );
              reported.add(cardId);
              emitWhenReady();
            },
            (error) => {
              if (currentGeneration !== generation) return;
              paymentsByCard.set(cardId, []);
              reported.add(cardId);
              onError?.(error);
              emitWhenReady();
            },
          ),
        );
      }
    },
    (error) => onError?.(error),
  );

  return () => {
    generation += 1;
    cardsUnsub();
    paymentUnsubs.forEach((unsubscribe) => unsubscribe());
  };
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
 * Ambas barras miran el mismo universo: el ingreso repartido y el consumo de
 * Necesidad/Ocio. Los pagos de deuda quedan fuera para no contar dos veces una
 * compra, y el uso de Ahorro conserva su análisis separado.
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

  const states = new Map<
    string,
    {
      month: Month | null;
      monthReported: boolean;
      expenses: ExpenseTransaction[];
      expensesReported: boolean;
    }
  >(
    candidateIds.map((id) => [
      id,
      {
        month: null,
        monthReported: false,
        expenses: [],
        expensesReported: false,
      },
    ]),
  );

  const emitWhenReady = () => {
    const ready = candidateIds.every((id) => {
      const state = states.get(id)!;
      return state.monthReported && state.expensesReported;
    });
    if (!ready) return;

    onData(
      candidateIds.flatMap((id) => {
        const state = states.get(id)!;
        if (!state.month) return [];
        const consumption = getConsumptionByCategory(state.expenses);
        return [
          {
            monthId: id,
            totalIncomeCents: state.month.totalIncomeCents,
            expenseCents: consumption.necesidad + consumption.ocio,
          },
        ];
      }),
    );
  };

  const unsubs = candidateIds.flatMap((id) => {
    const state = states.get(id)!;
    const monthUnsub = onSnapshot(
      doc(db, "users", userId, "months", id),
      (snap) => {
        state.month = snap.exists() ? (snap.data() as Month) : null;
        state.monthReported = true;
        emitWhenReady();
      },
    );
    const expensesUnsub = getMonthExpenses(userId, id, (expenses) => {
      state.expenses = expenses;
      state.expensesReported = true;
      emitWhenReady();
    });
    return [monthUnsub, expensesUnsub];
  });

  return () => unsubs.forEach((unsub) => unsub());
}
