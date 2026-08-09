import type { Timestamp } from "firebase/firestore";

export type Category = "necesidad" | "ocio" | "ahorro";

export type Distribution = {
  necesidad: number;
  ocio: number;
  ahorro: number;
};

export type TransactionBase = {
  type: "income" | "expense";
  serverDate: Timestamp | null;
  localDate: string;
  transactionDate: string;
  description?: string;
  amountCents: number;
};

export type IncomeTransaction = TransactionBase & {
  type: "income";
  source: string;
  sourceId?: string;
  distribution: Distribution;
};

export type ExpenseTransaction = TransactionBase & {
  type: "expense";
  category: Category;
  subcategory: string;
  paymentMethod: string;
  /**
   * Solo en compras de una meta de ahorro. Permite deshacer el contador de
   * compras si el egreso se borra desde el historial, sin tener que adivinar
   * por el nombre de la meta (que el usuario puede renombrar).
   */
  goalId?: string;
};

export type Transaction = IncomeTransaction | ExpenseTransaction;
