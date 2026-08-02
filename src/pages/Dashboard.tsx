// src/pages/Dashboard.tsx
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/store/authStore";
import { checkAndCloseMonth, moveSurplus } from "@/services/monthService";
import { getMonthId, shiftMonthId, formatMonthLabel } from "@/utils/date";
import { formatCents } from "@/utils/currency";
import {
  CAP_CATEGORY_ORDER,
  CATEGORY_META,
  getCategoryStatus,
} from "@/utils/category";
import { calculateDistribution } from "@/utils/distribution";
import type { Month, MonthCaps } from "@/types/month";
import BottomNav from "@/components/BottomNav";

const CURRENT_MONTH_ID = getMonthId();

type CategoryKey = "necesidad" | "ocio" | "ahorro";

export default function Dashboard() {
  const user = useAuthStore((s) => s.user);
  const userProfile = useAuthStore((s) => s.userProfile);
  const [viewedMonthId, setViewedMonthId] = useState(CURRENT_MONTH_ID);

  const hasCheckedClose = useRef(false);

  useEffect(() => {
    if (!user || hasCheckedClose.current) return;
    hasCheckedClose.current = true;
    checkAndCloseMonth(user.uid).catch((err) => {
      console.error("checkAndCloseMonth falló:", err);
    });
  }, [user]);

  if (!user) return null;

  const canGoForward = viewedMonthId < CURRENT_MONTH_ID;
  const isViewingCurrentMonth = viewedMonthId === CURRENT_MONTH_ID;

  return (
    <div className="min-h-dvh bg-stone-50 pb-24">
      <header className="flex items-center justify-between px-5 pt-8">
        <div>
          <p className="text-sm text-stone-500">
            Hola, {userProfile?.name ?? ""}
          </p>
          <h1 className="text-xl font-semibold text-stone-900">
            Resumen del mes
          </h1>
        </div>
        <div>
          <Link
            to="/settings"
            aria-label="Ajustes"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-stone-200 text-stone-500"
          >
            ⚙
          </Link>
        </div>
      </header>

      <MonthSummary
        key={viewedMonthId}
        userId={user.uid}
        monthId={viewedMonthId}
        canGoForward={canGoForward}
        isCurrentMonth={isViewingCurrentMonth}
        savingsTotalCents={userProfile?.savingsTotalCents ?? 0}
        onPrev={() => setViewedMonthId((id) => shiftMonthId(id, -1))}
        onNext={() => setViewedMonthId((id) => shiftMonthId(id, 1))}
      />

      {isViewingCurrentMonth && (
        <div className="mt-6 flex gap-3 px-5">
          <Link
            to="/income/new"
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-100 py-4 font-medium text-emerald-700"
          >
            ↑ Ingreso
          </Link>
          <Link
            to="/expense/new"
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-red-100 py-4 font-medium text-red-600"
          >
            ↓ Egreso
          </Link>
        </div>
      )}

      <BottomNav />
    </div>
  );
}

function MonthSummary({
  userId,
  monthId,
  canGoForward,
  isCurrentMonth,
  savingsTotalCents,
  onPrev,
  onNext,
}: {
  userId: string;
  monthId: string;
  canGoForward: boolean;
  isCurrentMonth: boolean;
  savingsTotalCents: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const [month, setMonth] = useState<Month | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const monthRef = doc(db, "users", userId, "months", monthId);
    const unsubscribe = onSnapshot(
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
    return () => unsubscribe();
  }, [userId, monthId]);

  return (
    <>
      <div className="mx-5 mt-4 rounded-3xl bg-emerald-600 p-5 text-white">
        <p className="text-sm text-emerald-50">Ingreso total del mes</p>
        <p className="mt-1 text-3xl font-semibold">
          {loading ? "···" : formatCents(month?.totalIncomeCents ?? 0)}
        </p>
        <div className="mt-3 flex items-center justify-between">
          <p className="text-sm text-emerald-50">
            {month?.incomeCount ?? 0}{" "}
            {month?.incomeCount === 1
              ? "entrada registrada"
              : "entradas registradas"}
          </p>
          <div className="flex items-center gap-1 rounded-full bg-white/15 px-1.5 py-1">
            <button
              type="button"
              onClick={onPrev}
              aria-label="Mes anterior"
              className="flex h-5 w-5 items-center justify-center rounded-full text-xs"
            >
              ‹
            </button>
            <span className="px-1 text-xs font-medium">
              {formatMonthLabel(monthId)}
            </span>
            <button
              type="button"
              onClick={onNext}
              disabled={!canGoForward}
              aria-label="Mes siguiente"
              className="flex h-5 w-5 items-center justify-center rounded-full text-xs disabled:opacity-30"
            >
              ›
            </button>
          </div>
        </div>
      </div>

      <main className="mt-4 flex flex-col gap-3 px-5">
        {loading ? (
          <p className="py-8 text-center text-stone-400">Cargando...</p>
        ) : month === null ? (
          <p className="py-8 text-center text-stone-400">
            Sin datos para este mes
          </p>
        ) : (
          <>
            {CAP_CATEGORY_ORDER.map((cat) => (
              <CategoryRow
                key={cat}
                category={cat}
                month={month}
                userId={userId}
                monthId={monthId}
                isCurrentMonth={isCurrentMonth}
                savingsTotalCents={savingsTotalCents}
              />
            ))}
            <SavingsRow
              userId={userId}
              monthId={monthId}
              isCurrentMonth={isCurrentMonth}
              capsCents={month.capsCents}
              savingsTotalCents={savingsTotalCents}
              contributedThisMonth={month.ahorroContributedCents}
              percentage={month.distribution.ahorro}
            />
          </>
        )}
      </main>
    </>
  );
}

function CategoryRow({
  category,
  month,
  userId,
  monthId,
  isCurrentMonth,
  savingsTotalCents,
}: {
  category: keyof MonthCaps;
  month: Month;
  userId: string;
  monthId: string;
  isCurrentMonth: boolean;
  savingsTotalCents: number;
}) {
  const meta = CATEGORY_META[category];
  const cap = month.capsCents[category];
  const spent = month.spentCents[category];
  const pct = month.distribution[category];
  const status = getCategoryStatus(cap, spent);
  const [showMove, setShowMove] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const infoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (infoRef.current && !infoRef.current.contains(e.target as Node)) {
        setShowInfo(false);
      }
    }
    if (showInfo) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showInfo]);

  const canMoveSurplus =
    isCurrentMonth && !status.isEmpty && status.disponible > 0;

  const destinations: CategoryKey[] =
    category === "necesidad" ? ["ocio", "ahorro"] : ["necesidad", "ahorro"];

  const pureCap = calculateDistribution(
    month.totalIncomeCents,
    month.distribution,
  )[category];
  const capWasAdjusted = cap !== pureCap;

  return (
    <div
      ref={infoRef}
      className="relative rounded-2xl border border-stone-200 bg-white p-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${meta.bar}`} />
          <p className="text-sm font-medium text-stone-900">{meta.label}</p>
        </div>
        <div className="flex items-center gap-1">
          <p className="text-xs text-stone-400">{pct}%</p>
          <button
            type="button"
            onClick={() => setShowInfo((v) => !v)}
            aria-label={`Qué es el tope de ${meta.label}`}
            className="flex h-4 w-4 items-center justify-center rounded-full bg-stone-200 text-[10px] text-stone-500"
          >
            ?
          </button>
        </div>
      </div>

      {status.isEmpty ? (
        <p className="mt-3 text-sm text-stone-400">
          Aún sin ingresos registrados
        </p>
      ) : (
        <>
          <p
            className={`mt-3 text-2xl font-semibold ${
              status.isLow ? "text-red-600" : "text-emerald-600"
            }`}
          >
            {formatCents(status.disponible)}{" "}
            <span className="text-sm font-normal text-stone-400">
              disponible
            </span>
          </p>

          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-stone-200">
            <div
              className={`h-full rounded-full ${status.overCap ? "bg-red-500" : meta.bar}`}
              style={{ width: `${status.barWidth}%` }}
            />
          </div>

          <p className="mt-2 text-xs text-stone-400">
            Gastado {formatCents(spent)} de {formatCents(cap)}
          </p>

          {canMoveSurplus && !showMove && (
            <button
              type="button"
              onClick={() => setShowMove(true)}
              className="mt-2 text-xs font-medium text-teal-600"
            >
              Mover excedente →
            </button>
          )}

          {showMove && (
            <MoveSurplusPanel
              userId={userId}
              monthId={monthId}
              origin={category}
              disponibleCents={status.disponible}
              destinations={destinations}
              capsCents={month.capsCents}
              savingsTotalCents={savingsTotalCents}
              onClose={() => setShowMove(false)}
            />
          )}
        </>
      )}

      {showInfo && (
        <div className="absolute right-4 top-10 z-10 w-56 rounded-xl bg-stone-900 px-3 py-2 text-xs text-white shadow-lg">
          {capWasAdjusted
            ? `Tu tope es ${formatCents(cap)}. No es solo tu ${pct}% actual: incluye ingresos recibidos con otro % o plata movida entre categorías este mes.`
            : `Tu tope es ${formatCents(cap)}, según tu ${pct}% configurado.`}
        </div>
      )}
    </div>
  );
}

function MoveSurplusPanel({
  userId,
  monthId,
  origin,
  disponibleCents,
  destinations,
  capsCents,
  savingsTotalCents,
  onClose,
}: {
  userId: string;
  monthId: string;
  origin: CategoryKey;
  disponibleCents: number;
  destinations: CategoryKey[];
  capsCents: MonthCaps;
  savingsTotalCents: number;
  onClose: () => void;
}) {
  const [amountInput, setAmountInput] = useState("");
  const [destination, setDestination] = useState<CategoryKey>(destinations[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedAmount = parseFloat(amountInput);
  const amountCents =
    Number.isFinite(parsedAmount) && parsedAmount > 0
      ? Math.round(parsedAmount * 100)
      : 0;
  const exceedsAvailable = amountCents > disponibleCents;

  function currentValue(cat: CategoryKey): number {
    return cat === "ahorro" ? savingsTotalCents : capsCents[cat];
  }

  async function handleConfirm() {
    if (amountCents <= 0) {
      setError("Ingresa un monto mayor a 0");
      return;
    }
    if (exceedsAvailable) {
      setError("El monto supera el disponible");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await moveSurplus(userId, monthId, amountCents, origin, destination);
      onClose();
    } catch (err) {
      console.error("Error al mover excedente:", err);
      setError(
        err instanceof Error ? err.message : "No se pudo mover el excedente",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl bg-sky-50 p-3">
      <p className="text-sm font-medium text-teal-700">Mover excedente</p>

      <div className="mt-2 flex gap-2">
        <input
          value={amountInput}
          onChange={(e) => setAmountInput(e.target.value)}
          type="number"
          inputMode="decimal"
          step="0.01"
          placeholder="Monto S/"
          className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm outline-none"
        />
        <select
          value={destination}
          onChange={(e) => setDestination(e.target.value as CategoryKey)}
          className="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm"
        >
          {destinations.map((dest) => (
            <option key={dest} value={dest}>
              A {CATEGORY_META[dest].label}
            </option>
          ))}
        </select>
      </div>

      {amountCents > 0 && !exceedsAvailable && (
        <p className="mt-2 text-xs text-teal-700">
          {CATEGORY_META[origin].label} quedaría en{" "}
          {formatCents(currentValue(origin) - amountCents)} ·{" "}
          {CATEGORY_META[destination].label} pasaría a{" "}
          {formatCents(currentValue(destination) + amountCents)}
        </p>
      )}

      {exceedsAvailable && (
        <p className="mt-2 text-xs text-red-500">
          Supera el disponible ({formatCents(disponibleCents)})
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="flex-1 rounded-lg border border-stone-300 py-1.5 text-xs text-stone-600"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={saving || amountCents <= 0 || exceedsAvailable}
          className="flex-1 rounded-lg bg-teal-600 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {saving ? "Moviendo..." : "Confirmar"}
        </button>
      </div>
    </div>
  );
}

function SavingsRow({
  userId,
  monthId,
  isCurrentMonth,
  capsCents,
  savingsTotalCents,
  contributedThisMonth,
  percentage,
}: {
  userId: string;
  monthId: string;
  isCurrentMonth: boolean;
  capsCents: MonthCaps;
  savingsTotalCents: number;
  contributedThisMonth: number;
  percentage: number;
}) {
  const meta = CATEGORY_META.ahorro;
  const [showInfo, setShowInfo] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const infoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (infoRef.current && !infoRef.current.contains(e.target as Node)) {
        setShowInfo(false);
      }
    }
    if (showInfo) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showInfo]);

  const canMoveSurplus = isCurrentMonth && savingsTotalCents > 0;

  return (
    <div
      ref={infoRef}
      className="relative rounded-2xl border border-stone-200 bg-white p-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${meta.bar}`} />
          <p className="text-sm font-medium text-stone-900">{meta.label}</p>
        </div>
        <div className="flex items-center gap-1">
          <p className="text-xs text-stone-400">Acumulado</p>
          <button
            type="button"
            onClick={() => setShowInfo((v) => !v)}
            aria-label="Qué es el acumulado"
            className="flex h-4 w-4 items-center justify-center rounded-full bg-stone-200 text-[10px] text-stone-500"
          >
            ?
          </button>
        </div>
      </div>

      <p className="mt-3 text-2xl font-semibold text-teal-700">
        {formatCents(savingsTotalCents)}
      </p>

      <div className="mt-3 flex items-center justify-between border-t border-stone-100 pt-3 text-xs text-stone-400">
        <span>{percentage}% este mes</span>
        <span>+{formatCents(contributedThisMonth)}</span>
      </div>

      {canMoveSurplus && !showMove && (
        <button
          type="button"
          onClick={() => setShowMove(true)}
          className="mt-2 text-xs font-medium text-teal-600"
        >
          Usar ahorro →
        </button>
      )}

      {showMove && (
        <MoveSurplusPanel
          userId={userId}
          monthId={monthId}
          origin="ahorro"
          disponibleCents={savingsTotalCents}
          destinations={["necesidad", "ocio"]}
          capsCents={capsCents}
          savingsTotalCents={savingsTotalCents}
          onClose={() => setShowMove(false)}
        />
      )}

      {showInfo && (
        <div className="absolute bottom-full left-4 mb-2 w-56 rounded-xl bg-stone-900 px-3 py-2 text-xs text-white shadow-lg">
          Tu Ahorro nunca se resetea - cada mes se suma más, y solo baja cuando
          comprás una meta. El "+" de abajo es lo que entró este mes, no tu
          crecimiento neto: si sacaste plata de Ahorro, no se resta de ahí.
        </div>
      )}
    </div>
  );
}
