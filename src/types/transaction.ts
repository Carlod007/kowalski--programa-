import type { Timestamp } from "firebase/firestore";

export type Category = "necesidad" | "ocio" | "ahorro";

export type Distribution = {
  necesidad: number;
  ocio: number;
  ahorro: number;
};

export type TransactionBase = {
  type: "income" | "expense" | "loan";
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
  /**
   * Aporte que fue entero al ahorro sin repartirse. Marca explícita en vez de
   * deducirlo de un reparto 0/0/100: un reparto normal podría dar eso mismo
   * si el usuario tuviera Ahorro al 100%, y son cosas distintas.
   */
  isDirectSavings?: boolean;
};

export type ExpenseTransaction = TransactionBase & {
  type: "expense";
  category: Category;
  subcategory: string;
  paymentMethod: string;
  /**
   * En gastos vinculados a una meta de ahorro (compra o retiro de fondo).
   * Permite restaurar el estado correcto si el egreso se borra desde el
   * historial, sin tener que adivinar por el nombre de la meta.
   */
  goalId?: string;
  /** Gasto cubierto explícitamente con el saldo disponible de un préstamo. */
  fundedByLoanId?: string;
  fundedByLoanName?: string;
  /** Pago de deuda vinculado a un registro de pago del préstamo. */
  loanPaymentId?: string;
  loanId?: string;
  /** Compra o cargo que aumentó la deuda de una tarjeta de crédito. */
  creditCardId?: string;
  creditCardName?: string;
  /** Los intereses se corrigen desde su estado de cuenta, no aisladamente. */
  creditCardStatementId?: string;
  creditCardChargeKind?: "interest-fees";
};

export type LoanReceiptTransaction = TransactionBase & {
  type: "loan";
  loanId: string;
  lender?: string;
  destinationCategory: "necesidad" | "ocio";
};

export type Transaction =
  | IncomeTransaction
  | ExpenseTransaction
  | LoanReceiptTransaction;
