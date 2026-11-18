/**
 * Normaliza un monto en centavos (o contador entero) a entero sin signo -0.
 * En el SDK Web de Firestore, `-0` se serializa como `doubleValue` en lugar de
 * `integerValue`, convirtiendo el campo en `double` en Firestore.
 */
export function toIntCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value);
  return Object.is(rounded, -0) || rounded === 0 ? 0 : rounded;
}

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("es-PE", {
    style: "currency",
    currency: "PEN",
    minimumFractionDigits: 2,
  });
}
