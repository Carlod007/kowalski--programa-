import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  limit as queryLimit,
  runTransaction,
  serverTimestamp,
  type Unsubscribe,
  type WithFieldValue,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getGoalAllocated, getUnassignedCents } from "@/utils/savings";
import { toDateInputValue } from "@/utils/date";
import type { SavingsGoal, User } from "@/types/user";
import type {
  AllocationDirection,
  GoalAllocation,
} from "@/types/goalAllocation";

/**
 * Asignar y liberar NO mueven plata: solo cambian la etiqueta de a qué meta
 * está reservada. Por eso ninguna de las dos toca savingsTotalCents - si lo
 * hicieran, estarían inventando o borrando dinero.
 *
 * Ambas releen el perfil dentro de la transacción para validar contra el
 * estado real (no contra lo que la pantalla tenía cargado), porque el ahorro
 * total pudo haber cambiado por un ingreso, un cierre de mes o un movimiento
 * de excedente mientras el usuario tenía la pantalla abierta.
 */

async function updateGoals(
  userId: string,
  mutate: (goals: SavingsGoal[], profile: User) => SavingsGoal[],
): Promise<void> {
  const userRef = doc(db, "users", userId);

  await runTransaction(db, async (transaction) => {
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists()) {
      throw new Error(`savingsGoalService: perfil ${userId} no existe`);
    }
    const profile = userSnap.data() as User;
    const goals = profile.savingsGoals ?? [];
    transaction.update(userRef, { savingsGoals: mutate(goals, profile) });
  });
}

/**
 * Cambia lo asignado a una meta y deja el rastro en la misma transacción: o
 * pasan las dos cosas o no pasa ninguna. Nunca puede quedar una asignación sin
 * su registro, ni un registro de algo que no ocurrió.
 */
async function changeAllocation(
  userId: string,
  goalId: string,
  amountCents: number,
  direction: AllocationDirection,
): Promise<void> {
  if (amountCents <= 0) {
    throw new Error("El monto debe ser mayor a 0");
  }

  const userRef = doc(db, "users", userId);
  const allocationRef = doc(collection(db, "users", userId, "goalAllocations"));

  await runTransaction(db, async (transaction) => {
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists()) {
      throw new Error(`savingsGoalService: perfil ${userId} no existe`);
    }

    const profile = userSnap.data() as User;
    const goals = profile.savingsGoals ?? [];
    const goal = goals.find((g) => g.id === goalId);
    if (!goal) {
      throw new Error("Esa meta ya no existe");
    }

    const allocated = getGoalAllocated(goal);
    let nextAllocated: number;

    if (direction === "assign") {
      const unassigned = getUnassignedCents(
        profile.savingsTotalCents ?? 0,
        goals,
      );
      if (amountCents > unassigned) {
        throw new Error("No tienes tanto ahorro sin asignar");
      }
      nextAllocated = allocated + amountCents;
    } else {
      if (amountCents > allocated) {
        throw new Error("Esa meta no tiene tanto asignado");
      }
      nextAllocated = allocated - amountCents;
    }

    transaction.update(userRef, {
      savingsGoals: goals.map((g) =>
        g.id === goalId ? { ...g, allocatedCents: nextAllocated } : g,
      ),
    });

    const allocation: WithFieldValue<GoalAllocation> = {
      userId,
      goalId,
      goalName: goal.name,
      direction,
      amountCents,
      transactionDate: toDateInputValue(),
      serverDate: serverTimestamp(),
    };
    transaction.set(allocationRef, allocation);
  });
}

export async function assignToGoal(
  userId: string,
  goalId: string,
  amountCents: number,
): Promise<void> {
  await changeAllocation(userId, goalId, amountCents, "assign");
}

export type GoalAllocationWithId = GoalAllocation & { _id: string };

/**
 * Devuelve null si la consulta falla, para poder distinguir "no hay
 * asignaciones" de "no se pudieron leer". Decir lo primero cuando pasa lo
 * segundo sería mentirle al usuario sobre su propio historial.
 */
export function getGoalAllocations(
  userId: string,
  max: number,
  onData: (allocations: GoalAllocationWithId[] | null) => void,
): Unsubscribe {
  const ref = collection(db, "users", userId, "goalAllocations");
  const q = query(ref, orderBy("serverDate", "desc"), queryLimit(max));

  return onSnapshot(
    q,
    (snap) => {
      onData(
        snap.docs.map(
          (d) =>
            ({ ...(d.data() as GoalAllocation), _id: d.id }) as
              GoalAllocationWithId,
        ),
      );
    },
    (err) => {
      // Que falle el historial no rompe la pantalla: las metas y sus montos
      // se siguen viendo igual.
      console.error("getGoalAllocations falló:", err);
      onData(null);
    },
  );
}

/**
 * Guarda la definición de las metas desde Ajustes (nombre, objetivo, tipo,
 * cuáles existen). Nunca escribe allocatedCents: ese valor se relee del
 * servidor y se conserva.
 *
 * Sin esto, un borrador abierto en Ajustes antes de asignar plata pisaría la
 * asignación al guardar, y el usuario perdería el apartado sin enterarse.
 * Las metas que el borrador ya no incluye simplemente desaparecen, y su plata
 * vuelve a quedar sin asignar (no se pierde: sin asignar se calcula por resta).
 */
export async function saveGoalDefinitions(
  userId: string,
  drafts: SavingsGoal[],
): Promise<void> {
  await updateGoals(userId, (currentGoals) => {
    const allocatedById = new Map(
      currentGoals.map((g) => [g.id, getGoalAllocated(g)]),
    );
    return drafts.map((draft) => ({
      ...draft,
      allocatedCents: allocatedById.get(draft.id) ?? 0,
    }));
  });
}

export async function unassignFromGoal(
  userId: string,
  goalId: string,
  amountCents: number,
): Promise<void> {
  await changeAllocation(userId, goalId, amountCents, "release");
}
