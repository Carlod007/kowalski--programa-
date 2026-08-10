import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/store/authStore";
import { useAhorroBreakdown } from "@/hooks/useAhorroBreakdown";
import { getMonthId, shiftMonthId, formatMonthLabel } from "@/utils/date";
import { formatCents } from "@/utils/currency";
import { calculateDistribution } from "@/utils/distribution";
import type { Month } from "@/types/month";
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
          aquí.
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
    return () => unsubMonth();
  }, [userId, monthId]);

  const {
    initialSplitAhorroCents,
    isInitialSplitDeterminable,
    movedToAhorroCents,
    movedOutOfAhorroCents,
    untrackedCents,
    isUntrackedDeterminable,
    netContributionCents,
    ahorroActualPct,
    isAhorroActualDeterminable,
  } = useAhorroBreakdown(
    userId,
    monthId,
    month?.ahorroContributedCents ?? 0,
    month?.totalIncomeCents ?? 0,
    month?.directSavingsCents ?? 0,
  );

  const directSavingsCents = month?.directSavingsCents ?? 0;

  const ahorroContributedCents = month?.ahorroContributedCents ?? 0;
  const pureAhorroCap = month
    ? calculateDistribution(month.totalIncomeCents, month.distribution).ahorro
    : 0;

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
              {directSavingsCents > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-stone-600">De aportes directos</span>
                  <span className="font-medium text-stone-900">
                    {formatCents(directSavingsCents)}
                  </span>
                </div>
              )}
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
                <span className="text-stone-600">Reparto inicial</span>
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
            {/* Contraparte de la aclaración en Metas: esta pantalla mide el
                flujo del mes, no cómo está repartido el acumulado. */}
            <p className="mt-2 text-xs text-stone-400">
              Esto es lo que se movió este mes. Cómo está repartido tu
              acumulado entre metas se ve en{" "}
              <Link to="/goals" className="font-medium text-teal-600">
                Metas de ahorro →
              </Link>
            </p>
          </div>
        </>
      )}
    </>
  );
}
