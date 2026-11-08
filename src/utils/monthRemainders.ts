import type { Month, MonthCaps } from "@/types/month";

type RemainderInput = Pick<
  Month,
  "capsCents" | "spentCents" | "borrowedCapsCents" | "loanFundedSpentCents"
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

  const rawNec = rawOwnedFor("necesidad");
  const rawOcio = rawOwnedFor("ocio");

  const ocioToAhorroCents = Math.max(0, rawOcio - Math.max(0, -rawNec));
  const necesidadToNextMonthCents = Math.max(
    0,
    rawNec - Math.max(0, -rawOcio),
  );
  const netDeficitCents = Math.max(0, -(rawNec + rawOcio));

  const borrowedNecesidad = borrowedFor("necesidad");
  const borrowedOcio = borrowedFor("ocio");

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
