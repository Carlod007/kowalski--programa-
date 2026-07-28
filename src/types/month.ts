import type { Timestamp } from "firebase/firestore";
import type { Distribution } from "./transaction";

export type MonthRemainder = {
  ocioToAhorroCents: number;
};

export type MonthCaps = {
  necesidad: number;
  ocio: number;
};

export type Month = {
  totalIncomeCents: number;
  distribution: Distribution;
  capsCents: MonthCaps;
  spentCents: MonthCaps;
  ahorroContributedCents: number;
  incomeCount: number;
  closed: boolean;
  remainder?: MonthRemainder;
  createdAt: Timestamp | null;
};
