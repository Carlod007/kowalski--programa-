import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/store/authStore";
import { getMonthId, shiftMonthId, formatMonthLabel } from "@/utils/date";
import { formatCents } from "@/utils/currency";
import type { Month } from "@/types/month";
import BackButton from "@/components/BackButton";

const CURRENT_MONTH_ID = getMonthId();

export default function CloseMonth() {
  const user = useAuthStore((s) => s.user);
  const userProfile = useAuthStore((s) => s.userProfile);
  const navigate = useNavigate();
  const { monthId: monthIdParam } = useParams<{ monthId: string }>();

  const viewedMonthId = monthIdParam ?? CURRENT_MONTH_ID;

  const [month, setMonth] = useState<Month | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !viewedMonthId) return;
    const uid = user.uid;
    const monthId = viewedMonthId;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const snap = await getDoc(doc(db, "users", uid, "months", monthId));

        if (cancelled) return;

        setMonth(snap.exists() ? (snap.data() as Month) : null);
        setLoading(false);
      } catch (err) {
        console.error("CloseMonth load error:", err);
        if (!cancelled) {
          setError("Error al cargar los datos. Intenta de nuevo.");
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [user, viewedMonthId]);

  const isProjection = viewedMonthId === CURRENT_MONTH_ID && !month?.closed;
  const canGoForward = !!viewedMonthId && viewedMonthId < CURRENT_MONTH_ID;

  function goTo(delta: number) {
    if (!viewedMonthId) return;
    navigate(`/close-month/${shiftMonthId(viewedMonthId, delta)}`);
  }

  return (
    <div className="min-h-dvh bg-stone-50 px-5 pt-8 pb-10">
      <BackButton to="/dashboard" />

      <div className="mt-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-stone-900">Cierre de mes</h1>
        {viewedMonthId && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => goTo(-1)}
              aria-label="Mes anterior"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-stone-200"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => goTo(1)}
              disabled={!canGoForward}
              aria-label="Mes siguiente"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-stone-200 disabled:opacity-30"
            >
              ›
            </button>
          </div>
        )}
      </div>

      {!viewedMonthId ? (
        <p className="mt-8 text-center text-stone-400">
          Todavía no hay meses cerrados para mostrar.
        </p>
      ) : loading ? (
        <p className="mt-8 text-center text-stone-400">Cargando...</p>
      ) : error ? (
        <p className="mt-8 text-center text-red-600">{error}</p>
      ) : !month ? (
        <p className="mt-8 text-center text-stone-400">
          Sin datos para este mes.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-stone-500">
            {isProjection
              ? `Así va ${formatMonthLabel(viewedMonthId)}`
              : `Así quedó ${formatMonthLabel(viewedMonthId)}`}
          </p>

          {isProjection && (
            <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2">
              <p className="text-xs font-medium text-amber-700">
                Proyección - el mes sigue abierto, esto no es definitivo
                todavía.
              </p>
            </div>
          )}

          <div className="mt-6 rounded-2xl border border-stone-200 bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-stone-400">
              Resumen {formatMonthLabel(viewedMonthId)}
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <Row label="Ingreso total" value={month.totalIncomeCents} />
              <Row
                label="Necesidad gastado"
                value={month.spentCents.necesidad}
              />
              <Row label="Ocio gastado" value={month.spentCents.ocio} />
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-stone-400">
              {isProjection
                ? "Qué pasaría con el saldo sobrante si cerrara ahora"
                : "Qué pasó con el saldo sobrante"}
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <Row
                label="Necesidad no usada → se sumaría al mes nuevo"
                value={Math.max(
                  0,
                  month.capsCents.necesidad - month.spentCents.necesidad,
                )}
              />
              <Row
                label="Ocio sobrante → se sumaría a tu Ahorro"
                value={
                  isProjection
                    ? Math.max(0, month.capsCents.ocio - month.spentCents.ocio)
                    : (month.remainder?.ocioToAhorroCents ?? 0)
                }
                valueClassName="text-teal-700"
              />
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-stone-400">
              Ahorro acumulado total
            </p>
            <p className="mt-2 text-2xl font-semibold text-teal-700">
              {formatCents(userProfile?.savingsTotalCents ?? 0)}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: number;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-stone-600">{label}</span>
      <span
        className={`text-sm font-medium whitespace-nowrap ${valueClassName ?? "text-stone-900"}`}
      >
        {formatCents(value)}
      </span>
    </div>
  );
}
