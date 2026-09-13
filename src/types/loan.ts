import type { Timestamp } from "firebase/firestore";
import type { Category } from "./transaction";
import type { MonthCaps } from "./month";

export type LoanDestinationCategory = Exclude<Category, "ahorro">;
export type LoanPaymentSource = Category;
export type LoanScheduleType = "fixed-known" | "total-known" | "custom";

export type LoanInstallment = {
  id: string;
  number: number;
  dueDate: string;
  amountCents: number;
  paidCents: number;
};

export type Loan = {
  userId: string;
  lender?: string;
  amountReceivedCents: number;
  totalToRepayCents: number;
  /** Método usado para construir el calendario. Ausente en préstamos antiguos. */
  scheduleType?: LoanScheduleType;
  /** Se incorporó después de su recepción, sin reabrir meses pasados. */
  importedExisting?: boolean;
  receivedDate: string;
  receivedMonthId: string;
  destinationCategory: LoanDestinationCategory;
  borrowedAvailableCents: number;
  /** Saldo prestado disponible en cada categoría; el total se conserva arriba. */
  borrowedAvailableByCategory?: MonthCaps;
  /** Cantidad de reasignaciones inmutables realizadas entre Necesidad y Ocio. */
  fundMovementCount?: number;
  paidCents: number;
  installments: LoanInstallment[];
  receiptTransactionId: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
};

export type LoanWithId = Loan & { id: string };

export type LoanPaymentAllocation = {
  installmentId: string;
  amountCents: number;
};

export type LoanPayment = {
  userId: string;
  loanId: string;
  loanName: string;
  monthId: string;
  amountCents: number;
  paymentDate: string;
  sourceCategory: LoanPaymentSource;
  paymentMethod: string;
  allocations: LoanPaymentAllocation[];
  description?: string;
  transactionId: string;
  serverDate: Timestamp | null;
  localDate: string;
};

export type LoanFundMovement = {
  userId: string;
  loanId: string;
  loanName: string;
  origin: LoanDestinationCategory;
  destination: LoanDestinationCategory;
  amountCents: number;
  transactionDate: string;
  serverDate: Timestamp | null;
};

export type LoanFundMovementWithId = LoanFundMovement & { id: string };
