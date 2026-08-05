import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/store/authStore";
import {
  getMonthMovements,
  getMonthInitialSplit,
  type MovementWithId,
} from "@/services/movementService";
import { getMonthId, shiftMonthId, formatMonthLabel, formatDateLabel } from "@/utils/date";
import { formatCents } from "@/utils/currency";
import { CATEGORY_META } from "@/utils/category";
import { calculateDistribution } from "@/utils/distribution";
import type { Month } from "@/types/month";
import type { Category } from "@/types/transaction";
import BackButton from "@/components/BackButton";

const CURRENT_MONTH_ID = getMonthId();

export default function Movements() {
  const user = useAuthStore((s) => s.user);
  const savingsTotalCents = useAuthStore(
    (s) => s.userProfile?.savingsTotalCents ?? 0,
  );
  const [viewedMonthId, setViewedMonthId] = useState(CURRENT_MONTH_ID);

  if (!user) return null;

  return (
    <div className="min-h-dvh bg-stone-50 px-5 pt-8 pb-10">
      <div className="flex items-center gap-3">
        <BackButton to="/dashboard" />
        <h1 className="text-xl font-semibold text-stone-900">Movimientos</h1>
      </div>

      <div className="mt-5 flex items-center justify-center">
        <div className="flex items-center gap-2 rounded-full bg-stone-100 px-2 py-1.5">
          <button
            type="button"
            onClick={() => setViewedMonthId((id) => shiftMonthId(id, -1))}
            className="flex h-6 w-6 items-center justify-center rounded-full text-stone-500"
          >
            ‹
          </button>
          <span className="text-sm font-semibold text-stone-900">
            {formatMonthLabel(viewedMonthId)}
          </span>
          <button
            type="button"
            onClick={() => setViewedMonthId((id) => shiftMonthId(id, 1))}
            disabled={viewedMonthId >= CURRENT_MONTH_ID}
            className="flex h-6 w-6 items-center justify-center rounded-full text-stone-500 disabled:opacity-30"
          >
            ›
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
        <p className="text-xs text-amber-800">
          Solo se registran los movimientos hechos desde que existe esta
          pantalla. Ajustes de excedente anteriores no quedaron guardados
          acá.
        </p>
      </div>

      <MovementsContent
        key={viewedMonthId}
        userId={user.uid}
        monthId={viewedMonthId}
        savingsTotalCents={savingsTotalCents}
      />
    </div>
  );
}

function MovementsContent({
  userId,
  monthId,
  savingsTotalCents,
}: {
  userId: string;
  monthId: string;
  savingsTotalCents: number;
}) {
  const [month, setMonth] = useState<Month | null>(null);
  const [movements, setMovements] = useState<MovementWithId[]>([]);
  const [initialSplitAhorroCents, setInitialSplitAhorroCents] = useState(0);
  const [isInitialSplitDeterminable, setIsInitialSplitDeterminable] =
    useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const monthRef = doc(db, "users", userId, "months", monthId);
    const unsubMonth = onSnapshot(
      monthRef,
      (snap) => {
        setMonth(snap.exists() ? (snap.data() as Month) : null);
        setLoading(false);
      },
      (err) => {
        console.error("onSnapshot mes falló:", err);
        setLoading(false);
      },
    );

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
      unsubMonth();
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
  const ahorroContributedCents = month?.ahorroContributedCents ?? 0;
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
  const pureAhorroCap = month
    ? calculateDistribution(month.totalIncomeCents, month.distribution).ahorro
    : 0;
  // % actual de Ahorro: siempre desde el aporte neto de ESTE mes, nunca
  // desde savingsTotalCents (es acumulado de varios meses, no comparable
  // contra el ingreso de un solo mes). Si hay un ajuste sin rastrear, no se
  // inventa un %: se muestra "no determinable".
  const ahorroActualPct =
    month && month.totalIncomeCents > 0
      ? ((netContributionCents / month.totalIncomeCents) * 100).toFixed(1)
      : null;
  const isAhorroActualDeterminable =
    isInitialSplitDeterminable && untrackedCents === 0;

  return (
    <>
      {loading ? (
        <p className="mt-8 text-center text-stone-400">Cargando...</p>
      ) : !month ? (
        <p className="mt-8 text-center text-stone-400">
          Sin datos para este mes
        </p>
      ) : (
        <>
          <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-stone-400">
              Ahorro aportado este mes
            </p>
            <p className="mt-2 text-2xl font-semibold text-teal-700">
              {formatCents(ahorroContributedCents)}
            </p>
            <div className="mt-3 flex flex-col gap-1 border-t border-stone-100 pt-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-stone-600">Del reparto inicial</span>
                <span className="font-medium text-stone-900">
                  {isInitialSplitDeterminable
                    ? formatCents(initialSplitAhorroCents)
                    : "No determinable"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-stone-600">De movimientos</span>
                <span className="font-medium text-stone-900">
                  {formatCents(movedToAhorroCents)}
                </span>
              </div>
              {(untrackedCents !== 0 || !isInitialSplitDeterminable) && (
                <div className="flex items-center justify-between">
                  <span className="text-stone-600">
                    {isUntrackedDeterminable
                      ? "Ajuste anterior no registrado"
                      : "No determinable"}
                  </span>
                  <span className="font-medium text-stone-900">
                    {isUntrackedDeterminable
                      ? formatCents(untrackedCents)
                      : "—"}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-stone-400">
              Balance de Ahorro este mes
            </p>
            <div className="mt-3 flex flex-col gap-1 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-stone-600">Plan inicial</span>
                <span className="font-medium text-stone-900">
                  {month.distribution.ahorro}% ·{" "}
                  {formatCents(pureAhorroCap)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-stone-600">Actual</span>
                <span className="font-medium text-stone-900">
                  {!isAhorroActualDeterminable
                    ? "No determinable"
                    : netContributionCents < 0
                      ? "Aporte neto negativo"
                      : ahorroActualPct !== null
                        ? `${ahorroActualPct}%`
                        : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-stone-600">Movido hacia Ahorro</span>
                <span className="font-medium text-emerald-700">
                  +{formatCents(movedToAhorroCents)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-stone-600">Movido fuera de Ahorro</span>
                <span className="font-medium text-red-600">
                  -{formatCents(movedOutOfAhorroCents)}
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-stone-100 pt-2">
                <span className="text-stone-600">Aporte neto del mes</span>
                <span className="font-medium text-stone-900">
                  {formatCents(netContributionCents)}
                </span>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-stone-100 pt-3">
              <span className="text-sm text-stone-600">
                Saldo acumulado global
              </span>
              <span className="text-lg font-semibold text-teal-700">
                {formatCents(savingsTotalCents)}
              </span>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3">
            {movements.length === 0 ? (
              <p className="py-8 text-center text-stone-400">
                No hay movimientos registrados este mes
              </p>
            ) : (
              movements.map((m) => (
                <MovementRow key={m._id} movement={m} />
              ))
            )}
          </div>
        </>
      )}
    </>
  );
}

function MovementRow({ movement }: { movement: MovementWithId }) {
  const originMeta = CATEGORY_META[movement.origin as Category];
  const destMeta = CATEGORY_META[movement.destination as Category];

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-stone-900">
          <span className={originMeta.text}>{originMeta.label}</span>
          <span className="text-stone-400">→</span>
          <span className={destMeta.text}>{destMeta.label}</span>
        </div>
        <span className="text-sm font-semibold text-teal-700">
          {formatCents(movement.amountCents)}
        </span>
      </div>
      <p className="mt-1 text-xs text-stone-400">
        {formatDateLabel(movement.transactionDate)}
      </p>
      {movement.reason && (
        <p className="mt-1 text-xs text-stone-500">{movement.reason}</p>
      )}
    </div>
  );
}
