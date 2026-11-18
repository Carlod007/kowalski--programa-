import type { Month, MonthCaps } from "@/types/month";
import { toIntCents } from "./currency";

type RemainderInput = Pick<
  Month,
  | "capsCents"
  | "spentCents"
  | "borrowedCapsCents"
  | "loanFundedSpentCents"
  | "carriedDeficitCents"
>;

export type MonthRemainders = {
  owned: MonthCaps;
  borrowed: MonthCaps;
  ocioToAhorroCents: number;
  necesidadToNextMonthCents: number;
  netDeficitCents: number;
};

export function getMonthRemainders(month: RemainderInput): MonthRemainders {
  const borrowedCaps = month.borrowedCapsCents ?? {
    necesidad: 0,
    ocio: 0,
  };
  const loanFundedSpent = month.loanFundedSpentCents ?? {
    necesidad: 0,
    ocio: 0,
  };
  const carriedDeficit = month.carriedDeficitCents ?? 0;

  const borrowedFor = (category: keyof MonthCaps) =>
    Math.max(0, borrowedCaps[category] - loanFundedSpent[category]);

  const rawOwnedFor = (category: keyof MonthCaps) => {
    const ownedCap = Math.max(
      0,
      month.capsCents[category] - borrowedCaps[category],
    );
    const ownedSpent = Math.max(
      0,
      month.spentCents[category] - loanFundedSpent[category],
    );
    return ownedCap - ownedSpent;
  };

  const rawNec = rawOwnedFor("necesidad") - carriedDeficit;
  const rawOcio = rawOwnedFor("ocio");

  const ocioToAhorroCents = toIntCents(
    Math.max(0, rawOcio - Math.max(0, -rawNec)),
  );
  const necesidadToNextMonthCents = toIntCents(
    Math.max(0, rawNec - Math.max(0, -rawOcio)),
  );
  const netDeficitCents = toIntCents(Math.max(0, -(rawNec + rawOcio)));

  const borrowedNecesidad = toIntCents(borrowedFor("necesidad"));
  const borrowedOcio = toIntCents(borrowedFor("ocio"));

  return {
    owned: {
      necesidad: necesidadToNextMonthCents,
      ocio: ocioToAhorroCents,
    },
    borrowed: {
      necesidad: borrowedNecesidad,
      ocio: borrowedOcio,
    },
    ocioToAhorroCents,
    necesidadToNextMonthCents,
    netDeficitCents,
  };
}
