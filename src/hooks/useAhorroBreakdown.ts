import { useEffect, useState } from "react";
import {
  getMonthMovements,
  getMonthInitialSplit,
  type MovementWithId,
} from "@/services/movementService";

export type AhorroBreakdown = {
  movements: MovementWithId[];
  initialSplitAhorroCents: number;
  isInitialSplitDeterminable: boolean;
  movedToAhorroCents: number;
  movedOutOfAhorroCents: number;
  untrackedCents: number;
  isUntrackedDeterminable: boolean;
  netContributionCents: number;
  ahorroActualPct: string | null;
  isAhorroActualDeterminable: boolean;
};

/**
 * Desglose real del aporte a Ahorro de un mes: mezcla el reparto inicial
 * (leído de las transacciones), los movimientos de excedente registrados, y
 * el total ya acreditado en el mes. Compartido entre Dashboard y Movements
 * para no duplicar esta lógica en dos lugares.
 */
export function useAhorroBreakdown(
  userId: string,
  monthId: string,
  ahorroContributedCents: number,
  totalIncomeCents: number,
): AhorroBreakdown {
  const [movements, setMovements] = useState<MovementWithId[]>([]);
  const [initialSplitAhorroCents, setInitialSplitAhorroCents] = useState(0);
  const [isInitialSplitDeterminable, setIsInitialSplitDeterminable] =
    useState(true);

  useEffect(() => {
    const unsubMovements = getMonthMovements(userId, monthId, setMovements);
    const unsubInitialSplit = getMonthInitialSplit(
      userId,
      monthId,
      (split) => {
        setInitialSplitAhorroCents(split?.ahorro ?? 0);
        setIsInitialSplitDeterminable(split !== null);
      },
    );
    return () => {
      unsubMovements();
      unsubInitialSplit();
    };
  }, [userId, monthId]);

  const movedToAhorroCents = movements
    .filter((m) => m.destination === "ahorro")
    .reduce((sum, m) => sum + m.amountCents, 0);
  const movedOutOfAhorroCents = movements
    .filter((m) => m.origin === "ahorro")
    .reduce((sum, m) => sum + m.amountCents, 0);
  // No se infiere por resta: el reparto inicial se lee directo de cada
  // ingreso. Lo que sobra sin explicar (viejos ajustes anteriores a este
  // historial, o correcciones de datos) se muestra aparte, nunca se le
  // atribuye al reparto inicial.
  const untrackedCents =
    ahorroContributedCents - initialSplitAhorroCents - movedToAhorroCents;
  const isUntrackedDeterminable =
    isInitialSplitDeterminable && untrackedCents >= 0;
  // "Aporte neto" sí resta las salidas (a diferencia de ahorroContributedCents,
  // que el código nunca decrementa cuando se saca plata de Ahorro) - es un
  // dato adicional más honesto, no reemplaza al de arriba.
  const netContributionCents =
    initialSplitAhorroCents + movedToAhorroCents - movedOutOfAhorroCents;
  // % actual de Ahorro: siempre desde el aporte neto de ESTE mes, nunca
  // desde savingsTotalCents (es acumulado de varios meses, no comparable
  // contra el ingreso de un solo mes). Si hay un ajuste sin rastrear, no se
  // inventa un %: se muestra "no determinable".
  const ahorroActualPct =
    totalIncomeCents > 0
      ? ((netContributionCents / totalIncomeCents) * 100).toFixed(1)
      : null;
  const isAhorroActualDeterminable =
    isInitialSplitDeterminable && untrackedCents === 0;

  return {
    movements,
    initialSplitAhorroCents,
    isInitialSplitDeterminable,
    movedToAhorroCents,
    movedOutOfAhorroCents,
    untrackedCents,
    isUntrackedDeterminable,
    netContributionCents,
    ahorroActualPct,
    isAhorroActualDeterminable,
  };
}
