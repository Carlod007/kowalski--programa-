import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/store/authStore";
import { getMonthId, shiftMonthId, formatMonthLabel } from "@/utils/date";
import { formatCents } from "@/utils/currency";
import type { Month } from "@/types/month";
import BackButton from "@/components/BackButton";

export default function CloseMonth() {
  const user = useAuthStore((s) => s.user);
  const userProfile = useAuthStore((s) => s.userProfile);

  const [prevMonthId, setPrevMonthId] = useState<string | null>(null);
  const [prevMonth, setPrevMonth] = useState<Month | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const uid = user.uid;
    let cancelled = false;

    async function load() {
      try {
        const pid = shiftMonthId(getMonthId(), -1);
        const snap = await getDoc(doc(db, "users", uid, "months", pid));

        if (cancelled) return;

        if (!snap.exists() || !snap.data().closed) {
          setPrevMonthId(null);
          setPrevMonth(null);
          setLoading(false);
          return;
        }

        setPrevMonthId(pid);
        setPrevMonth(snap.data() as Month);
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
  }, [user]);

  return (
    <div className="min-h-dvh bg-stone-50 px-5 pt-8 pb-10">
      <BackButton to="/dashboard" />

      <h1 className="mt-4 text-2xl font-semibold text-stone-900">
        Cierre de mes
      </h1>

      {loading ? (
        <p className="mt-8 text-center text-stone-400">Cargando...</p>
      ) : error ? (
        <p className="mt-8 text-center text-red-600">{error}</p>
      ) : !prevMonth || !prevMonthId ? (
        <p className="mt-8 text-center text-stone-400">
          Todavía no hay meses cerrados para mostrar.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-stone-500">
            Así quedó {formatMonthLabel(prevMonthId)}
          </p>

          <div className="mt-6 rounded-2xl border border-stone-200 bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-stone-400">
              Resumen {formatMonthLabel(prevMonthId)}
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <Row label="Ingreso total" value={prevMonth.totalIncomeCents} />
              <Row
                label="Necesidad gastado"
                value={prevMonth.spentCents.necesidad}
              />
              <Row label="Ocio gastado" value={prevMonth.spentCents.ocio} />
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-stone-400">
              Qué pasó con el saldo sobrante
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <Row
                label="Necesidad no usada → se sumó al mes nuevo"
                value={Math.max(
                  0,
                  prevMonth.capsCents.necesidad - prevMonth.spentCents.necesidad,
                )}
              />
              <Row
                label="Ocio sobrante → se sumó a tu Ahorro"
                value={prevMonth.remainder?.ocioToAhorroCents ?? 0}
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
