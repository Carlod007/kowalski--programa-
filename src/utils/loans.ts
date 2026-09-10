import type {
  Loan,
  LoanInstallment,
  LoanPaymentAllocation,
} from "@/types/loan";
import type { MonthCaps } from "@/types/month";

export function getBorrowedAvailableByCategory(loan: Loan): MonthCaps {
  if (loan.borrowedAvailableByCategory) {
    return loan.borrowedAvailableByCategory;
  }
  return loan.destinationCategory === "necesidad"
    ? { necesidad: loan.borrowedAvailableCents, ocio: 0 }
    : { necesidad: 0, ocio: loan.borrowedAvailableCents };
}

export function reassignBorrowedBalance(
  available: MonthCaps,
  origin: keyof MonthCaps,
  destination: keyof MonthCaps,
  amountCents: number,
): MonthCaps {
  if (origin === destination) throw new Error("Las categorías deben ser distintas");
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error("El monto debe ser mayor a 0");
  }
  if (amountCents > available[origin]) {
    throw new Error("El monto supera los fondos prestados disponibles");
  }
  return {
    ...available,
    [origin]: available[origin] - amountCents,
    [destination]: available[destination] + amountCents,
  };
}

function parseDate(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) throw new Error("Fecha inválida");
  return { year, month, day };
}

export function addMonthsToDate(value: string, months: number): string {
  const { year, month, day } = parseDate(value);
  const targetIndex = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(targetIndex / 12);
  const targetMonthIndex = targetIndex % 12;
  const lastDay = new Date(
    Date.UTC(targetYear, targetMonthIndex + 1, 0),
  ).getUTCDate();
  const targetDay = Math.min(day, lastDay);
  return `${targetYear}-${String(targetMonthIndex + 1).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}

export function generateLoanInstallments(
  totalToRepayCents: number,
  count: number,
  firstDueDate: string,
): LoanInstallment[] {
  if (!Number.isInteger(totalToRepayCents) || totalToRepayCents <= 0) {
    throw new Error("El total a devolver debe ser mayor a 0");
  }
  if (!Number.isInteger(count) || count <= 0 || count > 360) {
    throw new Error("La cantidad de cuotas debe estar entre 1 y 360");
  }
  if (count > totalToRepayCents) {
    throw new Error("Cada cuota debe ser de al menos un centavo");
  }

  const base = Math.floor(totalToRepayCents / count);
  const remainder = totalToRepayCents - base * count;

  return Array.from({ length: count }, (_, index) => ({
    id: `installment-${index + 1}`,
    number: index + 1,
    dueDate: addMonthsToDate(firstDueDate, index),
    amountCents: base + (index === count - 1 ? remainder : 0),
    paidCents: 0,
  }));
}

export function getLoanOutstandingCents(loan: Loan): number {
  return Math.max(0, loan.totalToRepayCents - loan.paidCents);
}

export function allocateLoanPayment(
  installments: LoanInstallment[],
  amountCents: number,
): { installments: LoanInstallment[]; allocations: LoanPaymentAllocation[] } {
  const outstanding = installments.reduce(
    (sum, item) => sum + Math.max(0, item.amountCents - item.paidCents),
    0,
  );
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error("El pago debe ser mayor a 0");
  }
  if (amountCents > outstanding) {
    throw new Error("El pago supera la deuda pendiente");
  }

  let remaining = amountCents;
  const allocations: LoanPaymentAllocation[] = [];
  const orderedIds = [...installments]
    .sort((a, b) =>
      a.dueDate === b.dueDate
        ? a.number - b.number
        : a.dueDate.localeCompare(b.dueDate),
    )
    .map((item) => item.id);

  const paidById = new Map<string, number>();
  for (const id of orderedIds) {
    if (remaining === 0) break;
    const item = installments.find((candidate) => candidate.id === id)!;
    const pending = Math.max(0, item.amountCents - item.paidCents);
    const applied = Math.min(pending, remaining);
    if (applied > 0) {
      paidById.set(id, applied);
      allocations.push({ installmentId: id, amountCents: applied });
      remaining -= applied;
    }
  }

  return {
    installments: installments.map((item) => ({
      ...item,
      paidCents: item.paidCents + (paidById.get(item.id) ?? 0),
    })),
    allocations,
  };
}

export function reverseLoanPayment(
  installments: LoanInstallment[],
  allocations: LoanPaymentAllocation[],
): LoanInstallment[] {
  const reversedById = new Map(
    allocations.map((allocation) => [
      allocation.installmentId,
      allocation.amountCents,
    ]),
  );
  return installments.map((item) => ({
    ...item,
    paidCents: Math.max(0, item.paidCents - (reversedById.get(item.id) ?? 0)),
  }));
}

export type LoanInstallmentStatus = "pending" | "partial" | "paid" | "overdue";

export function getLoanInstallmentStatus(
  installment: LoanInstallment,
  today: string,
): LoanInstallmentStatus {
  if (installment.paidCents >= installment.amountCents) return "paid";
  if (installment.dueDate < today) return "overdue";
  if (installment.paidCents > 0) return "partial";
  return "pending";
}

export function getNextPendingInstallment(
  loan: Loan,
): LoanInstallment | null {
  return (
    [...loan.installments]
      .filter((item) => item.paidCents < item.amountCents)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] ?? null
  );
}
