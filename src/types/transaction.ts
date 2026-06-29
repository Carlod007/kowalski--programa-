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
  description?: string;
  amount: number;
};

export type IncomeTransaction = TransactionBase & {
  type: "income";
  source: string;
  distribution: Distribution;
};

export type ExpenseTransaction = TransactionBase & {
  type: "expense";
  category: Category;
  subcategory: string;
  paymentMethod: string;
};

export type Transaction = IncomeTransaction | ExpenseTransaction;
