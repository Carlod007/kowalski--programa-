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
import type { Distribution, IncomeTransaction } from "@/types/transaction";

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
 * Un reparto solo es válido si cada parte es un entero (los montos son
 * centavos, nunca fracciones) no negativo, y si la suma de las tres partes
 * coincide exactamente con el monto del ingreso al que pertenece - así es
 * como registerIncomeSplit siempre lo escribe. Cualquier desvío es una
 * señal de dato corrupto, no algo que se pueda promediar o ignorar.
 */
function isValidIncomeSplit(
  value: unknown,
  amountCents: number,
): value is Distribution {
  if (!value || typeof value !== "object") return false;
  const d = value as Record<string, unknown>;
  const parts = [d.necesidad, d.ocio, d.ahorro];
  const allValid = parts.every(
    (n) => typeof n === "number" && Number.isInteger(n) && n >= 0,
  );
  if (!allValid) return false;
  const sum = (d.necesidad as number) + (d.ocio as number) + (d.ahorro as number);
  return sum === amountCents;
}

/**
 * Suma real de distribution.{necesidad,ocio,ahorro} de cada ingreso del mes
 * - el reparto inicial verdadero, leído de lo que quedó guardado en cada
 * transacción, nunca inferido por resta ni por un cálculo aproximado (eso
 * puede atribuir mal ajustes viejos que no pasaron por moveSurplus, como una
 * migración de datos, o esconder un movimiento real detrás de una
 * tolerancia de redondeo).
 *
 * Devuelve null (no determinable) si la consulta falla o si algún ingreso
 * histórico tiene distribution incompleta/corrupta - nunca inventa un 0 en
 * su lugar, porque eso se leería como "no hubo reparto" en vez de "no se
 * pudo leer".
 */
export function getMonthInitialSplit(
  userId: string,
  monthId: string,
  onData: (split: Distribution | null) => void,
): Unsubscribe {
  const ref = collection(db, "users", userId, "months", monthId, "transactions");
  const q = query(ref, where("type", "==", "income"));

  return onSnapshot(
    q,
    (snap) => {
      const total = { necesidad: 0, ocio: 0, ahorro: 0 };
      for (const d of snap.docs) {
        const tx = d.data() as IncomeTransaction;
        if (!isValidIncomeSplit(tx.distribution, tx.amountCents)) {
          onData(null);
          return;
        }
        total.necesidad += tx.distribution.necesidad;
        total.ocio += tx.distribution.ocio;
        total.ahorro += tx.distribution.ahorro;
      }
      onData(total);
    },
    (err) => {
      console.error("getMonthInitialSplit falló:", err);
      onData(null);
    },
  );
}
