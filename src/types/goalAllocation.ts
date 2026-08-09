import type { Timestamp } from "firebase/firestore";

export type AllocationDirection = "assign" | "release";

/**
 * Registro inmutable de una asignación o liberación de plata hacia/desde una
 * meta. Se escribe atómicamente junto al cambio de allocatedCents - nunca se
 * edita ni se borra.
 *
 * No registra compras ni retiros: esos ya dejan su rastro como egreso en el
 * historial, y duplicarlos acá sería mostrar dos veces lo mismo.
 *
 * goalName es una foto del nombre al momento de la operación, para que el
 * historial siga siendo legible aunque después se renombre o se borre la meta.
 */
export type GoalAllocation = {
  userId: string;
  goalId: string;
  goalName: string;
  direction: AllocationDirection;
  amountCents: number;
  transactionDate: string;
  serverDate: Timestamp | null;
};
