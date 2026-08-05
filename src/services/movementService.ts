import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Movement } from "@/types/movement";
import type { IncomeTransaction } from "@/types/transaction";

export type MovementWithId = Movement & { _id: string };

export function getMonthMovements(
  userId: string,
  monthId: string,
  onData: (movements: MovementWithId[]) => void,
): Unsubscribe {
  const ref = collection(db, "users", userId, "months", monthId, "movements");
  const q = query(ref, orderBy("serverDate", "desc"));

  return onSnapshot(q, (snap) => {
    const movements = snap.docs.map(
      (d) => ({ ...(d.data() as Movement), _id: d.id }) as MovementWithId,
    );
    onData(movements);
  });
}

/**
 * Suma real de distribution.ahorro de cada ingreso del mes — el reparto
 * inicial verdadero, leído de lo que quedó guardado en cada transacción,
 * nunca inferido por resta (eso puede atribuir mal ajustes viejos que no
 * pasaron por moveSurplus, como una migración de datos).
 */
export function getMonthInitialAhorroSplit(
  userId: string,
  monthId: string,
  onData: (totalCents: number) => void,
): Unsubscribe {
  const ref = collection(db, "users", userId, "months", monthId, "transactions");
  const q = query(ref, where("type", "==", "income"));

  return onSnapshot(q, (snap) => {
    const total = snap.docs.reduce((sum, d) => {
      const tx = d.data() as IncomeTransaction;
      return sum + tx.distribution.ahorro;
    }, 0);
    onData(total);
  });
}
