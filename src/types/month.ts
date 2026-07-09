import type { Timestamp } from "firebase/firestore";
import type { Distribution } from "./transaction";

export type MonthRemainder = {
  destination: "ahorro" | "next_month";
  amountCents: number;
};

export type Month = {
  totalIncomeCents: number;
  distribution: Distribution;
  capsCents: Distribution;
  spentCents: Distribution;
  incomeCount: number;
  closed: boolean;
  remainder?: MonthRemainder;
  createdAt: Timestamp | null;
};
