import type { CreditCard } from "@/types/creditCard";
import type { Month } from "@/types/month";

/**
 * Dinero prestado vigente en los topes de Necesidad y Ocio del mes.
 * Incluye lo arrastrado de meses anteriores y excluye préstamos importados
 * ya gastados (`borrowedAvailableCents: 0`), que no alteran `borrowedCapsCents`.
 */
export function getBorrowedEnvelopesCents(
  month: Pick<Month, "borrowedCapsCents"> | null | undefined,
): number {
  const necesidad = Math.max(0, month?.borrowedCapsCents?.necesidad ?? 0);
  const ocio = Math.max(0, month?.borrowedCapsCents?.ocio ?? 0);
  return necesidad + ocio;
}

/**
 * Suma de la deuda actual de todas las tarjetas de crédito registradas.
 */
export function getTotalCreditCardsDebtCents(
  cards: readonly Pick<CreditCard, "currentDebtCents">[],
): number {
  return cards.reduce(
    (sum, card) => sum + Math.max(0, card.currentDebtCents),
    0,
  );
}
