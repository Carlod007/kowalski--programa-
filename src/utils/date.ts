export const DEFAULT_TIME_ZONE = "America/Lima";

export type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
};

export type NowEnvironment = {
  dev?: boolean;
  useEmulator?: boolean;
  fakeNow?: string;
};

/**
 * Zona horaria por defecto para toda la app. Si el perfil define otra, se pasa
 * explícitamente a las funciones de fecha.
 */
export function resolveTimeZone(timeZone?: string | null): string {
  return isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
}

/** Valida contra Intl.supportedValuesOf cuando el navegador lo expone. */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "") return false;
  const candidate = value.trim();
  const intl = Intl as typeof Intl & {
    supportedValuesOf?: (key: "timeZone") => string[];
  };
  if (typeof intl.supportedValuesOf === "function") {
    try {
      return intl.supportedValuesOf("timeZone").includes(candidate);
    } catch {
      // Algunos motores antiguos exponen la función pero no aceptan "timeZone".
    }
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return true;
  } catch {
    return false;
  }
}

/**
 * Fecha simulada de desarrollo. Solo se respeta con Vite en modo DEV y con el
 * emulador activo (`VITE_USE_EMULATOR="true"`). Un build de producción ignora
 * siempre VITE_FAKE_NOW.
 */
export function resolveNow(environment: NowEnvironment): Date {
  if (environment.dev === true && environment.useEmulator === true) {
    const raw = environment.fakeNow?.trim();
    if (raw) {
      const parsed = new Date(raw);
      if (Number.isFinite(parsed.getTime())) return parsed;
    }
  }
  return new Date();
}

/** Fuente única de “ahora” para meses, cierre, gracia y validación de fechas. */
export function now(): Date {
  return resolveNow({
    dev: import.meta.env.DEV,
    useEmulator: import.meta.env.VITE_USE_EMULATOR === "true",
    fakeNow: import.meta.env.VITE_FAKE_NOW,
  });
}

export function getZonedDateParts(
  date: Date = now(),
  timeZone: string = DEFAULT_TIME_ZONE,
): ZonedDateParts {
  const zone = resolveTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const read = (type: "year" | "month" | "day") =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: read("year"), month: read("month"), day: read("day") };
}

export function getMonthId(
  date: Date = now(),
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  const { year, month } = getZonedDateParts(date, timeZone);
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function shiftMonthId(monthId: string, delta: number): string {
  const [year, month] = monthId.split("-").map(Number);
  const absolute = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(absolute / 12);
  const nextMonth = (absolute % 12) + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
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

export function formatMonthLongLabel(monthId: string): string {
  const [year, month] = monthId.split("-").map(Number);
  const date = new Date(year, month - 1, 1);
  const label = date.toLocaleDateString("es-PE", {
    month: "long",
    year: "numeric",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function toDateInputValue(
  date: Date = now(),
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  const { year, month, day } = getZonedDateParts(date, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Suma días a una fecha YYYY-MM-DD sin depender de la zona del navegador. */
export function shiftDateInputValue(dateValue: string, delta: number): string {
  const [year, month, day] = dateValue.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + delta));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

/** Último día calendario de un mes YYYY-MM. */
export function getLastDateInputOfMonth(monthId: string): string {
  const [year, month] = monthId.split("-").map(Number);
  const date = new Date(Date.UTC(year, month, 0));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function formatDayMonth(dateValue: string): string {
  const [, month, day] = dateValue.split("-");
  return `${day}/${month}`;
}

/** Hora local en formato de 24 horas, sin depender del ciclo del navegador. */
export function formatTime24(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

const WEEKDAYS = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];
const MONTHS = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
];

export function formatDateLabel(dateValue: string): string {
  const [year, month, day] = dateValue.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return `${WEEKDAYS[date.getDay()]}, ${day} ${MONTHS[month - 1]} ${year}`;
}

export function formatMonthShortLabel(monthId: string): string {
  const [year, month] = monthId.split("-").map(Number);
  const date = new Date(year, month - 1, 1);
  return date.toLocaleDateString("es-PE", { month: "short" }).replace(".", "");
}
