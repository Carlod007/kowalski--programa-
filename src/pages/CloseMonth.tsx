import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/store/authStore";
import {
  isRemainderPending,
  resolveMonthRemainder,
} from "@/services/monthService";
import { getMonthId, formatMonthLabel } from "@/utils/date";
import { formatCents } from "@/utils/currency";
import { CATEGORY_META } from "@/utils/category";
import SelectionCard from "@/components/SelectionCard";
import Step2Distribution from "@/pages/onboarding/Step2Distribution";
import type { Month } from "@/types/month";
import type { Distribution } from "@/types/transaction";

export default function CloseMonth() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const [prevMonthId, setPrevMonthId] = useState<string | null>(null);
  const [prevMonth, setPrevMonth] = useState<Month | null>(null);
  const [newMonth, setNewMonth] = useState<Month | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [remainderChoice, setRemainderChoice] = useState<
    "ahorro" | "next_month" | null
  >(null);
  const [editingDistribution, setEditingDistribution] = useState(false);
  const [distribution, setDistribution] = useState<Distribution>({
    necesidad: 70,
    ocio: 10,
    ahorro: 20,
  });

  useEffect(() => {
    if (!user) return;

    const uid = user.uid;
    let cancelled = false;

    async function load() {
      try {
        const { pending, prevMonthId: pid } = await isRemainderPending(uid);

        if (cancelled) return;

        if (!pending || !pid) {
          navigate("/dashboard", { replace: true });
          return;
        }

        const currentMonthId = getMonthId();
        const [prevSnap, newSnap] = await Promise.all([
          getDoc(doc(db, "users", uid, "months", pid)),
          getDoc(doc(db, "users", uid, "months", currentMonthId)),
        ]);

        if (cancelled) return;

        if (!prevSnap.exists() || !newSnap.exists()) {
          setError("No se pudieron cargar los datos del mes.");
          setLoading(false);
          return;
        }

        const prev = prevSnap.data() as Month;
        const curr = newSnap.data() as Month;

        setPrevMonthId(pid);
        setPrevMonth(prev);
        setNewMonth(curr);
        setDistribution(curr.distribution);
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
  }, [user, navigate]);

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center text-stone-400">
        Cargando...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-stone-600">{error}</p>
        <Link to="/dashboard" className="text-sm font-medium text-teal-700">
          Volver al inicio
        </Link>
      </div>
    );
  }

  if (!prevMonth || !newMonth || !prevMonthId) return null;

  const newMonthId = getMonthId();
  const totalSpent =
    prevMonth.spentCents.necesidad +
    prevMonth.spentCents.ocio +
    prevMonth.spentCents.ahorro;
  const netCents = prevMonth.totalIncomeCents - totalSpent;

  const distributionValid =
    distribution.necesidad + distribution.ocio + distribution.ahorro === 100;
  const needsChoice = netCents > 0 && remainderChoice === null;
  const isDisabled = saving || needsChoice || (editingDistribution && !distributionValid);

  async function handleConfirm() {
    if (!user || !prevMonthId) return;
    setSaving(true);

    try {
      await resolveMonthRemainder(user.uid, prevMonthId, newMonthId, {
        remainderDestination: netCents > 0 ? remainderChoice! : undefined,
        newDistribution: editingDistribution ? distribution : undefined,
      });
      navigate("/dashboard", { replace: true });
    } catch (err) {
      console.error("resolveMonthRemainder falló:", err);
      setError("No se pudo guardar. Revisa tu conexión e intenta de nuevo.");
      setSaving(false);
    }
  }

  return (
    <div className="min-h-dvh bg-stone-50 px-5 pt-8 pb-10">
      <Link to="/dashboard" className="text-sm text-stone-500">
        ← Más tarde
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-stone-900">
        Cierre de {formatMonthLabel(prevMonthId)}
      </h1>
      <p className="mt-1 text-sm text-stone-500">
        Revisa tu mes antes de comenzar {formatMonthLabel(newMonthId)}
      </p>

      {/* Resumen */}
      <div className="mt-6 rounded-2xl border border-stone-200 bg-white p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-stone-400">
          Resumen {formatMonthLabel(prevMonthId)}
        </p>

        <div className="mt-3 flex flex-col gap-2">
          <Row
            label="Ingreso total"
            value={prevMonth.totalIncomeCents}
          />
          <Row
            label="Necesidad gastado"
            value={prevMonth.spentCents.necesidad}
          />
          <Row label="Ocio gastado" value={prevMonth.spentCents.ocio} />
          <Row
            label="Ahorro acumulado"
            value={prevMonth.spentCents.ahorro}
            valueClassName="text-emerald-600"
          />
        </div>
      </div>

      {/* Remanente */}
      {netCents > 0 ? (
        <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-stone-400">
            Remanente disponible
          </p>
          <p className="mt-2 text-2xl font-semibold text-emerald-600">
            {formatCents(netCents)}
          </p>
          <p className="mt-1 text-sm text-stone-500">
            ¿Qué hacemos con este saldo?
          </p>

          <div className="mt-3 flex gap-3">
            <div className="flex-1">
              <SelectionCard
                label="Mover a ahorro"
                description="Se suma directo a tu ahorro del mes nuevo"
                selected={remainderChoice === "ahorro"}
                onSelect={() => setRemainderChoice("ahorro")}
              />
            </div>
            <div className="flex-1">
              <SelectionCard
                label="Ingreso extra"
                description="Se divide según tu distribución"
                selected={remainderChoice === "next_month"}
                onSelect={() => setRemainderChoice("next_month")}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-4">
          <p className="text-sm text-stone-600">
            Este mes cerró con saldo {formatCents(netCents)} — se perdona
            automáticamente.
          </p>
        </div>
      )}

      {/* Distribución */}
      <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-stone-400">
          Distribución para {formatMonthLabel(newMonthId)}
        </p>

        <div className="mt-3 flex items-center gap-3">
          {(["necesidad", "ocio", "ahorro"] as const).map((cat) => (
            <span key={cat} className="flex items-center gap-1.5 text-sm">
              <span
                className={`h-2 w-2 rounded-full ${CATEGORY_META[cat].bar}`}
              />
              <span className="text-stone-600">
                {editingDistribution ? distribution[cat] : newMonth.distribution[cat]}%
              </span>
            </span>
          ))}
        </div>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setEditingDistribution(false)}
            className={`flex-1 rounded-xl py-2 text-sm font-medium transition ${
              !editingDistribution
                ? "bg-stone-900 text-white"
                : "border border-stone-300 text-stone-600"
            }`}
          >
            Mantener
          </button>
          <button
            type="button"
            onClick={() => setEditingDistribution(true)}
            className={`flex-1 rounded-xl py-2 text-sm font-medium transition ${
              editingDistribution
                ? "bg-stone-900 text-white"
                : "border border-stone-300 text-stone-600"
            }`}
          >
            Modificar
          </button>
        </div>

        {editingDistribution && (
          <div className="mt-4">
            <Step2Distribution data={distribution} onChange={setDistribution} />
          </div>
        )}
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={handleConfirm}
        disabled={isDisabled}
        className="mt-6 w-full rounded-xl bg-stone-900 py-3 font-medium text-white disabled:opacity-50"
      >
        {saving ? "Guardando..." : `Comenzar ${formatMonthLabel(newMonthId)}`}
      </button>
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
    <div className="flex items-center justify-between">
      <span className="text-sm text-stone-600">{label}</span>
      <span className={`text-sm font-medium ${valueClassName ?? "text-stone-900"}`}>
        {formatCents(value)}
      </span>
    </div>
  );
}
