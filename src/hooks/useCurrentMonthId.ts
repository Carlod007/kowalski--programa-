import { useEffect, useRef, useState } from "react";
import { getMonthId } from "@/utils/date";
import { ensureCurrentMonth } from "@/services/monthService";

export type UseCurrentMonthIdOptions = {
  userId?: string | null;
  onMonthChange?: (nextMonthId: string, prevMonthId: string) => void;
};

export function msUntilNextDay(now: Date = new Date()): number {
  const nextMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    0,
    50,
  );
  return Math.max(100, nextMidnight.getTime() - now.getTime());
}

/**
 * Reloj reactivo del ID de mes actual (YYYY-MM).
 * Se actualiza automáticamente al próximo cambio de día (medianoche local),
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

  const { userId, onMonthChange } = options;

  const [currentMonthId, setCurrentMonthId] = useState<string>(() =>
    getMonthId(),
  );
  const monthIdRef = useRef<string>(currentMonthId);
  const userIdRef = useRef<string | null | undefined>(userId);
  const onMonthChangeRef = useRef<
    ((nextMonthId: string, prevMonthId: string) => void) | undefined
  >(onMonthChange);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    onMonthChangeRef.current = onMonthChange;
  }, [onMonthChange]);

  useEffect(() => {
    let timerId: ReturnType<typeof setTimeout> | null = null;

    function syncMonthId() {
      const next = getMonthId();
      if (next !== monthIdRef.current) {
        const prev = monthIdRef.current;
        monthIdRef.current = next;
        setCurrentMonthId(next);
        if (userIdRef.current) {
          void ensureCurrentMonth(userIdRef.current).catch((err) => {
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
      timerId = setTimeout(() => {
        syncMonthId();
        scheduleNextDayTick();
      }, msUntilNextDay());
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
