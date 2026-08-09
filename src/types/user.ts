import type { Timestamp } from "firebase/firestore";
import type { Distribution } from "./transaction";

export type Source = {
  id: string;
  name: string;
};

export type PaymentMethod = {
  id: string;
  name: string;
  type: "cash" | "digital";
};

export type ClosingNotification = {
  day: number;
  time: string;
};

/**
 * "compra" (por defecto): adquisiciones materiales o digitales. Solo se pueden
 * usar cuando la meta juntó su objetivo completo, y se gastan de una sola vez.
 * "fondo": colchón de emergencia. De libre disposición - se puede retirar de a
 * partes y sin haber llegado al objetivo, porque una emergencia no avisa ni
 * tiene precio fijo.
 */
export type GoalKind = "fondo" | "compra";

export type SavingsGoal = {
  id: string;
  name: string;
  targetCents: number;
  createdAt: Timestamp | null;
  /** Opcional: las metas creadas antes de esto se tratan como "compra". */
  kind?: GoalKind;
  /**
   * Plata del ahorro reservada para esta meta. Opcional: las metas viejas
   * arrancan en 0 y su plata queda como "sin asignar" (nada se pierde).
   */
  allocatedCents?: number;
  /**
   * Cuántas veces se compró esta meta. Es un contador y no un booleano porque
   * una meta se puede volver a juntar y comprar: si se borra una compra del
   * historial baja en uno, y solo al llegar a cero deja de figurar como
   * comprada.
   */
  purchaseCount?: number;
  /** Fecha (YYYY-MM-DD) de la última compra, para mostrarla. */
  lastPurchasedAt?: string;
};

export type FixedIncome = {
  id: string;
  name: string;
  monthlyAmountCents: number;
};

export type EssentialNeed = {
  id: string;
  name: string;
  monthlyAmountCents: number;
};

export type User = {
  name: string;
  email: string;
  sources: Source[];
  distribution: Distribution;
  subcategories: Record<"necesidad" | "ocio", string[]>;
  paymentMethods: PaymentMethod[];
  closingNotification: ClosingNotification;
  onboardingCompleted: boolean;
  lastClosedMonth: string | null;
  savingsTotalCents: number;
  savingsGoals: SavingsGoal[];
  fixedIncomes?: FixedIncome[];
  essentialNeeds?: EssentialNeed[];
};
