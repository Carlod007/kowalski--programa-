import { collection, doc, getDocs, query, runTransaction, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Transaction } from '@/types/transaction';
import type { CreditCard } from '@/types/creditCard';
import type { Loan } from '@/types/loan';
import type { User } from '@/types/user';
import { getGoalKind } from '@/utils/savings';
import { canEditTransactionTiming, validateTransactionTiming } from '@/utils/transactionTiming';

/** Corrige metadatos del mismo mes; no vuelve a aplicar importes ni repartos. */
export async function updateTransactionTiming(
  userId: string, monthId: string, txId: string, date: string,
): Promise<void> {
  validateTransactionTiming(monthId, date);
  const monthRef = doc(db, 'users', userId, 'months', monthId);
  const txRef = doc(collection(monthRef, 'transactions'), txId);
  const userRef = doc(db, 'users', userId);
  await runTransaction(db, async (transaction) => {
    const [monthSnap, txSnap] = await Promise.all([
      transaction.get(monthRef), transaction.get(txRef),
    ]);
    if (!monthSnap.exists() || monthSnap.data().closed) throw new Error('El mes está cerrado o no está disponible.');
    if (!txSnap.exists()) throw new Error('La transacción ya no existe.');
    const tx = txSnap.data() as Transaction;
    if (!canEditTransactionTiming(tx)) throw new Error('Esta operación vinculada se corrige desde su módulo original.');
    if (tx.type === 'expense' && tx.creditCardId) {
      const cardSnap = await transaction.get(doc(db, 'users', userId, 'creditCards', tx.creditCardId));
      if (!cardSnap.exists()) throw new Error('La tarjeta vinculada ya no existe.');
      const card = cardSnap.data() as CreditCard;
      if (card.lastStatementClosingDate && (tx.transactionDate <= card.lastStatementClosingDate || date <= card.lastStatementClosingDate)) {
        throw new Error('No puedes cambiar una compra de un estado confirmado ni trasladarla a ese período.');
      }
    }
    if (tx.type === 'expense' && tx.fundedByLoanId) {
      const loanSnap = await transaction.get(doc(db, 'users', userId, 'loans', tx.fundedByLoanId));
      if (!loanSnap.exists() || date < (loanSnap.data() as Loan).receivedDate) {
        throw new Error('La fecha no puede ser anterior a la recepción del préstamo.');
      }
    }
    if (tx.type === 'expense' && tx.goalId && tx.transactionDate !== date) {
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists()) throw new Error('No se encontró el perfil de la meta.');
      const goals = (userSnap.data() as User).savingsGoals ?? [];
      const goal = goals.find((item) => item.id === tx.goalId);
      if (goal && getGoalKind(goal) === 'compra') {
        // Se lee el perfil antes de la consulta. Las compras y eliminaciones
        // concurrentes lo modifican y fuerzan el reintento de toda la operación.
        const previous = goal.lastPurchasedAt;
        let latest = previous && previous > date ? previous : date;
        if (previous === tx.transactionDate && date < previous) {
          // Solo se corrige dentro del mes actual. Una compra de meses previos
          // siempre será anterior a la nueva fecha; aquí importan las demás
          // compras de esta meta en el mismo mes, incluso si comparten el día.
          const matchingDocs = await getDocs(query(collection(monthRef, 'transactions'), where('goalId', '==', tx.goalId)));
          const otherRefs = matchingDocs.docs.filter((item) => item.ref.path !== txRef.path).map((item) => item.ref);
          const otherSnaps = await Promise.all(otherRefs.map((ref) => transaction.get(ref)));
          const otherDates = otherSnaps.filter((snap) => snap.exists()).map((snap) => snap.data() as Transaction)
            .filter((item) => item.type === 'expense' && item.category === 'ahorro' && item.goalId === tx.goalId)
            .map((item) => item.transactionDate);
          latest = [date, ...otherDates].sort().at(-1)!;
        }
        if (latest !== previous) {
          transaction.update(userRef, { savingsGoals: goals.map((item) => item.id === goal.id ? { ...item, lastPurchasedAt: latest } : item) });
        }
      }
    }
    transaction.update(txRef, { transactionDate: date });
  });
}
