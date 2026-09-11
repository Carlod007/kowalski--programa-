import type {
  CreditCard,
  CreditCardStatementSummary,
} from "@/types/creditCard";

export function getCreditCardDisplayName(
  card: Pick<CreditCard, "issuer" | "name">,
): string {
  const issuer = card.issuer.trim();
  const name = card.name.trim();
  return name.toLocaleLowerCase() === issuer.toLocaleLowerCase()
    ? name
    : `${issuer} · ${name}`;
}

export function getAvailableCreditCents(
  card: Pick<CreditCard, "creditLimitCents" | "currentDebtCents">,
): number {
  return card.creditLimitCents - card.currentDebtCents;
}

function dateForDay(year: number, monthIndex: number, day: number): string {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const resolvedDay = Math.min(day, lastDay);
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(resolvedDay).padStart(2, "0")}`;
}

export function getMostRecentClosingDate(
  closingDay: number,
  today: Date = new Date(),
): string {
  const usePreviousMonth = today.getDate() < closingDay;
  const candidate = new Date(
    today.getFullYear(),
    today.getMonth() - (usePreviousMonth ? 1 : 0),
    1,
  );
  return dateForDay(
    candidate.getFullYear(),
    candidate.getMonth(),
    closingDay,
  );
}

export function getDueDateForClosing(
  closingDate: string,
  dueDay: number,
): string {
  const [year, month, closingDay] = closingDate.split("-").map(Number);
  const dueMonthOffset = dueDay > closingDay ? 0 : 1;
  const candidate = new Date(year, month - 1 + dueMonthOffset, 1);
  return dateForDay(candidate.getFullYear(), candidate.getMonth(), dueDay);
}

export type CreditCardStatementStatus =
  | "pending"
  | "minimum-covered"
  | "paid"
  | "overdue";

export function getCreditCardStatementStatus(
  statement: CreditCardStatementSummary,
  today: string,
): CreditCardStatementStatus {
  if (statement.paidCents >= statement.totalPaymentCents) return "paid";
  if (
    statement.dueDate < today &&
    statement.paidCents < statement.minimumPaymentCents
  ) {
    return "overdue";
  }
  if (statement.paidCents >= statement.minimumPaymentCents) {
    return "minimum-covered";
  }
  return "pending";
}
