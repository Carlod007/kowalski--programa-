import type { Timestamp } from "firebase/firestore";
import type { Distribution } from "./transaction";

export type MonthRemainder = {
  destination: "ahorro" | "next_month";
  amount: number;
};

export type Month = {
  totalIncome: number;
  distribution: Distribution;
  caps: Distribution;
  spent: Distribution;
  closed: boolean;
  remainder?: MonthRemainder;
  createdAt: Timestamp | null;
};
