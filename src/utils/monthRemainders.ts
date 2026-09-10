import type { Month, MonthCaps } from "@/types/month";

type RemainderInput = Pick<
  Month,
  "capsCents" | "spentCents" | "borrowedCapsCents" | "loanFundedSpentCents"
>;

export function getMonthRemainders(month: RemainderInput): {
  owned: MonthCaps;
  borrowed: MonthCaps;
} {
  const borrowedCaps = month.borrowedCapsCents ?? {
    necesidad: 0,
    ocio: 0,
  };
  const loanFundedSpent = month.loanFundedSpentCents ?? {
    necesidad: 0,
    ocio: 0,
  };

  const result = (category: keyof MonthCaps) => {
    const borrowed = Math.max(
      0,
      borrowedCaps[category] - loanFundedSpent[category],
    );
    const ownedCap = Math.max(0, month.capsCents[category] - borrowedCaps[category]);
    const ownedSpent = Math.max(
      0,
      month.spentCents[category] - loanFundedSpent[category],
    );
    return { owned: Math.max(0, ownedCap - ownedSpent), borrowed };
  };

  const necesidad = result("necesidad");
  const ocio = result("ocio");
  return {
    owned: { necesidad: necesidad.owned, ocio: ocio.owned },
    borrowed: { necesidad: necesidad.borrowed, ocio: ocio.borrowed },
  };
}
