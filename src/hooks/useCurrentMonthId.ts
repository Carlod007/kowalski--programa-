import { useEffect, useRef, useState } from "react";
import {
  getMonthId,
  getZonedDateParts,
  now,
  resolveTimeZone,
  shiftDateInputValue,
} from "@/utils/date";
import { ensureCurrentMonth } from "@/services/monthService";

export type UseCurrentMonthIdOptions = {
  userId?: string | null;
  timeZone?: string | null;
  onMonthChange?: (nextMonthId: string, prevMonthId: string) => void;
};

export function msUntilNextDay(
  nowDate: Date = now(),
  timeZone?: string,
): number {
  if (!timeZone) {
    const nextMidnight = new Date(
      nowDate.getFullYear(),
      nowDate.getMonth(),
      nowDate.getDate() + 1,
      0,
      0,
      0,
      50,
    );
    return Math.max(100, nextMidnight.getTime() - nowDate.getTime());
  }

  const zone = resolveTimeZone(timeZone);
  const { year, month, day } = getZonedDateParts(nowDate, zone);
  const nextDateInput = shiftDateInputValue(
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    1,
  );
  const [ny, nm, nd] = nextDateInput.split("-").map(Number);
  const targetUtc = new Date(Date.UTC(ny, nm - 1, nd, 0, 0, 0, 50));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(targetUtc);
  const getP = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value ?? 0);
  let hour = getP("hour");
  if (hour === 24) hour = 0;
  const minute = getP("minute");
  const second = getP("second");
  const sec = hour * 3600 + minute * 60 + second;
  const diffSec = hour >= 12 ? 24 * 3600 - sec : -sec;
  const midnightMs = targetUtc.getTime() + diffSec * 1000;
  return Math.max(100, midnightMs - nowDate.getTime());
}

/**
 * Reloj reactivo del ID de mes actual (YYYY-MM).
 * Se actualiza automáticamente al próximo cambio de día (medianoche local/zona),
 * al recuperar el foco de la ventana y en visibilitychange.
 * Si recibe userId (o cambia de mes con la app abierta), dispara ensureCurrentMonth.
 */
export function useCurrentMonthId(
  userIdOrOptions?: string | null | UseCurrentMonthIdOptions,
): string {
  const options: UseCurrentMonthIdOptions =
    typeof userIdOrOptions === "object" && userIdOrOptions !== null
      ? userIdOrOptions
      : { userId: userIdOrOptions };

  const { userId, timeZone, onMonthChange } = options;

  const [currentMonthId, setCurrentMonthId] = useState<string>(() =>
    getMonthId(now(), timeZone ? resolveTimeZone(timeZone) : undefined),
  );
  const monthIdRef = useRef<string>(currentMonthId);
  const userIdRef = useRef<string | null | undefined>(userId);
  const timeZoneRef = useRef<string | null | undefined>(timeZone);
  const onMonthChangeRef = useRef<
    ((nextMonthId: string, prevMonthId: string) => void) | undefined
  >(onMonthChange);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    timeZoneRef.current = timeZone;
    const resolved = getMonthId(
      now(),
      timeZone ? resolveTimeZone(timeZone) : undefined,
    );
    if (resolved !== monthIdRef.current) {
      const prev = monthIdRef.current;
      monthIdRef.current = resolved;
      setCurrentMonthId(resolved);
      onMonthChangeRef.current?.(resolved, prev);
    }
  }, [timeZone]);

  useEffect(() => {
    onMonthChangeRef.current = onMonthChange;
  }, [onMonthChange]);

  useEffect(() => {
    let timerId: ReturnType<typeof setTimeout> | null = null;

    function syncMonthId() {
      const zone = timeZoneRef.current
        ? resolveTimeZone(timeZoneRef.current)
        : undefined;
      const next = getMonthId(now(), zone);
      if (next !== monthIdRef.current) {
        const prev = monthIdRef.current;
        monthIdRef.current = next;
        setCurrentMonthId(next);
        if (userIdRef.current) {
          const promise = zone
            ? ensureCurrentMonth(userIdRef.current, now(), zone)
            : ensureCurrentMonth(userIdRef.current);
          void promise.catch((err) => {
            console.error("ensureCurrentMonth en cambio de mes falló:", err);
          });
        }
        onMonthChangeRef.current?.(next, prev);
      }
    }

    function scheduleNextDayTick() {
      if (timerId !== null) {
        clearTimeout(timerId);
      }
      const zone = timeZoneRef.current
        ? resolveTimeZone(timeZoneRef.current)
        : undefined;
      timerId = setTimeout(() => {
        syncMonthId();
        scheduleNextDayTick();
      }, msUntilNextDay(now(), zone));
    }

    function handleFocus() {
      syncMonthId();
      scheduleNextDayTick();
    }

    function handleVisibilityChange() {
      if (
        typeof document === "undefined" ||
        document.visibilityState === "visible"
      ) {
        syncMonthId();
        scheduleNextDayTick();
      }
    }

    // Verificar al montar por si cambió el mes entre el render inicial y el efecto
    syncMonthId();
    scheduleNextDayTick();

    if (typeof window !== "undefined") {
      window.addEventListener("focus", handleFocus);
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      if (timerId !== null) {
        clearTimeout(timerId);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", handleFocus);
      }
      if (typeof document !== "undefined") {
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange,
        );
      }
    };
  }, []);

  return currentMonthId;
}
