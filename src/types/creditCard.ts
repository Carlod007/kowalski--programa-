import type { Timestamp } from "firebase/firestore";

export type CreditCardPaymentMode = "total" | "minimum" | "other";

export type CreditCardStatementSummary = {
  id: string;
  closingDate: string;
  dueDate: string;
  statementBalanceCents: number;
  minimumPaymentCents: number;
  totalPaymentCents: number;
  paidCents: number;
};

export type CreditCard = {
  userId: string;
  issuer: string;
  name: string;
  creditLimitCents: number;
  currentDebtCents: number;
  closingDay: number;
  dueDay: number;
  lastStatementClosingDate?: string;
  activeStatement?: CreditCardStatementSummary;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
};

export type CreditCardWithId = CreditCard & { id: string };

export type CreditCardStatement = CreditCardStatementSummary & {
  userId: string;
  cardId: string;
  cardName: string;
  interestChargesCents: number;
  recordedMonthId: string;
  interestTransactionId?: string;
  createdAt: Timestamp | null;
};

export type CreditCardStatementWithId = CreditCardStatement & { id: string };

export type CreditCardPayment = {
  userId: string;
  cardId: string;
  cardName: string;
  statementId?: string;
  mode: CreditCardPaymentMode;
  amountCents: number;
  statementAppliedCents: number;
  paymentDate: string;
  serverDate: Timestamp | null;
};

export type CreditCardPaymentWithId = CreditCardPayment & { id: string };
