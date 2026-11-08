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

export type ExpenseTemplate = {
  id: string;
  category: "necesidad" | "ocio";
  subcategory: string;
  /** Si no existe, el usuario escribe el monto cada vez que usa la plantilla. */
  amountCents?: number;
  description?: string;
  paymentMethod: string;
};

export type SubcategoryBudget = {
  category: "necesidad" | "ocio";
  subcategory: string;
  monthlyLimitCents: number;
};

export type DataDeletionMode = "reset" | "delete-account";

export type ClosingMode = "auto_grace";

export type NecesidadSurplusPolicy =
  | "rollover_all"
  | "sweep_to_savings"
  | "rollover_capped";

export type OcioSurplusPolicy = "sweep_to_savings" | "rollover_all";

/** Decide el destino del sobrante propio después del neteo de déficits. */
export type ClosingPolicy = {
  necesidadSurplus: NecesidadSurplusPolicy;
  /** Tope entero en centavos para rollover_capped. */
  necesidadRolloverCapCents?: number;
  ocioSurplus: OcioSurplusPolicy;
};

export type User = {
  name: string;
  email: string;
  sources: Source[];
  distribution: Distribution;
  subcategories: Record<"necesidad" | "ocio", string[]>;
  paymentMethods: PaymentMethod[];
  onboardingCompleted: boolean;
  /**
   * Nota histórica (F4): pese al nombre heredado en Firestore, almacena el ID
   * del mes activo actual (YYYY-MM), no el último mes cerrado.
   */
  lastClosedMonth: string | null;
  /**
   * Mes inmediato anterior que sigue abierto durante la ventana de gracia
   * (días 1 a 3 del mes nuevo) a la espera de revisión/confirmación.
   */
  pendingCloseMonthId?: string | null;
  /**
   * Último mes cerrado cuyo resumen de cierre aún no fue visto por el usuario.
   * Persistido en Firestore para sincronizarse entre dispositivos.
   */
  unseenClosedMonthId?: string | null;
  /**
   * Modo de cierre mensual. En F5 solo se usa el valor por defecto "auto_grace".
   */
  closingMode?: ClosingMode;
  /**
   * Destino del sobrante propio al cerrar. Si falta, se comporta como el
   * histórico: Necesidad pasa al mes nuevo y Ocio va a Ahorro.
   */
  closingPolicy?: ClosingPolicy;
  /** Zona IANA para meses, cierre, gracia y fechas. Default: America/Lima. */
  timeZone?: string;
  savingsTotalCents: number;
  savingsGoals: SavingsGoal[];
  fixedIncomes?: FixedIncome[];
  essentialNeeds?: EssentialNeed[];
  /** Atajos de formulario: nunca guardan préstamos ni tarjetas. */
  expenseTemplates?: ExpenseTemplate[];
  /** Referencias informativas; no modifican los topes del mes. */
  subcategoryBudgets?: SubcategoryBudget[];
  /**
   * Activa temporalmente las reglas especiales de limpieza. Mientras exista,
   * no se permiten nuevas operaciones financieras y el proceso puede
   * reanudarse si la conexión o la aplicación se interrumpen.
   */
  dataDeletionMode?: DataDeletionMode;
  dataDeletionStartedAt?: Timestamp | null;
};
