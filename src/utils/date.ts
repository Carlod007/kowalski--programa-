export function getMonthId(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function shiftMonthId(monthId: string, delta: number): string {
  const [year, month] = monthId.split("-").map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return getMonthId(date);
}

export function formatMonthLabel(monthId: string): string {
  const [year, month] = monthId.split("-").map(Number);
  const date = new Date(year, month - 1, 1);
  const label = date.toLocaleDateString("es-PE", {
    month: "short",
    year: "numeric",
  });
  return label.charAt(0).toUpperCase() + label.slice(1).replace(".", "");
}
