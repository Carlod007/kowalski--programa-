export type AnalysisPeriodMode =
  | "month"
  | "first-half"
  | "second-half"
  | "custom";

export type AnalysisDateRange = {
  fromDate: string;
  toDate: string;
};

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CUSTOM_DAYS = 366;

function getLastDateOfMonth(monthId: string): string {
  const [year, month] = monthId.split("-").map(Number);
  const day = new Date(year, month, 0).getDate();
  return `${monthId}-${String(day).padStart(2, "0")}`;
}

function parseIsoDate(value: string): Date | null {
  if (!ISO_DATE_PATTERN.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

export function getAnalysisDateRange(
  monthId: string,
  mode: AnalysisPeriodMode,
  customRange?: AnalysisDateRange,
): AnalysisDateRange | null {
  if (mode === "month") {
    return { fromDate: `${monthId}-01`, toDate: getLastDateOfMonth(monthId) };
  }
  if (mode === "first-half") {
    return { fromDate: `${monthId}-01`, toDate: `${monthId}-15` };
  }
  if (mode === "second-half") {
    return { fromDate: `${monthId}-16`, toDate: getLastDateOfMonth(monthId) };
  }
  if (!customRange) return null;
  return validateAnalysisDateRange(customRange) ? null : customRange;
}

export function validateAnalysisDateRange(
  range: AnalysisDateRange,
): string | null {
  const from = parseIsoDate(range.fromDate);
  const to = parseIsoDate(range.toDate);
  if (!from || !to) return "Selecciona ambas fechas";
  if (from > to) return "La fecha inicial debe ser anterior a la final";
  const dayCount = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (dayCount > MAX_CUSTOM_DAYS) {
    return "El rango puede abarcar como máximo un año";
  }
  return null;
}

export function getMonthIdsInRange(range: AnalysisDateRange): string[] {
  const from = parseIsoDate(range.fromDate);
  const to = parseIsoDate(range.toDate);
  if (!from || !to || from > to) return [];

  const result: string[] = [];
  let year = from.getUTCFullYear();
  let month = from.getUTCMonth() + 1;
  const endYear = to.getUTCFullYear();
  const endMonth = to.getUTCMonth() + 1;

  while (year < endYear || (year === endYear && month <= endMonth)) {
    result.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      year += 1;
      month = 1;
    }
  }
  return result;
}

export function isDateInAnalysisRange(
  date: string,
  range: AnalysisDateRange,
): boolean {
  return date >= range.fromDate && date <= range.toDate;
}

export function formatAnalysisDateRange(range: AnalysisDateRange): string {
  const formatter = new Intl.DateTimeFormat("es-PE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const from = parseIsoDate(range.fromDate);
  const to = parseIsoDate(range.toDate);
  if (!from || !to) return "periodo seleccionado";
  return `${formatter.format(from).replace(".", "")} – ${formatter
    .format(to)
    .replace(".", "")}`;
}
