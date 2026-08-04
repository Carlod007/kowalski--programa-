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

export type SavingsGoal = {
  id: string;
  name: string;
  targetCents: number;
  createdAt: Timestamp | null;
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
