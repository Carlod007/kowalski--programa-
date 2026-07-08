export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("es-PE", {
    style: "currency",
    currency: "PEN",
    minimumFractionDigits: 2,
  });
}
