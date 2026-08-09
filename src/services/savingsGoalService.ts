import { doc, runTransaction } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getGoalAllocated, getUnassignedCents } from "@/utils/savings";
import type { SavingsGoal, User } from "@/types/user";

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

export async function assignToGoal(
  userId: string,
  goalId: string,
  amountCents: number,
): Promise<void> {
  if (amountCents <= 0) {
    throw new Error("El monto debe ser mayor a 0");
  }

  await updateGoals(userId, (goals, profile) => {
    const goal = goals.find((g) => g.id === goalId);
    if (!goal) {
      throw new Error("Esa meta ya no existe");
    }

    const unassigned = getUnassignedCents(
      profile.savingsTotalCents ?? 0,
      goals,
    );
    if (amountCents > unassigned) {
      throw new Error("No tienes tanto ahorro sin asignar");
    }

    return goals.map((g) =>
      g.id === goalId
        ? { ...g, allocatedCents: getGoalAllocated(g) + amountCents }
        : g,
    );
  });
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
  if (amountCents <= 0) {
    throw new Error("El monto debe ser mayor a 0");
  }

  await updateGoals(userId, (goals) => {
    const goal = goals.find((g) => g.id === goalId);
    if (!goal) {
      throw new Error("Esa meta ya no existe");
    }

    const allocated = getGoalAllocated(goal);
    if (amountCents > allocated) {
      throw new Error("Esa meta no tiene tanto asignado");
    }

    return goals.map((g) =>
      g.id === goalId ? { ...g, allocatedCents: allocated - amountCents } : g,
    );
  });
}
