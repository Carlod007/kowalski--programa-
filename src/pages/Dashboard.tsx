// src/pages/Dashboard.tsx
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/store/authStore";
import { checkAndCloseMonth } from "@/services/monthService";
import { getMonthId, shiftMonthId, formatMonthLabel } from "@/utils/date";
import { formatCents } from "@/utils/currency";
import {
  CAP_CATEGORY_ORDER,
  CATEGORY_META,
  getCategoryStatus,
} from "@/utils/category";
import type { Month, MonthCaps } from "@/types/month";
import BottomNav from "@/components/BottomNav";

const CURRENT_MONTH_ID = getMonthId();

export default function Dashboard() {
  const user = useAuthStore((s) => s.user);
  const userProfile = useAuthStore((s) => s.userProfile);
  const [viewedMonthId, setViewedMonthId] = useState(CURRENT_MONTH_ID);

  useEffect(() => {
    if (!user) return;
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
            ↓ Ingreso
          </Link>
          <Link
            to="/expense/new"
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-red-100 py-4 font-medium text-red-600"
          >
            ↑ Egreso
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
  savingsTotalCents,
  onPrev,
  onNext,
}: {
  userId: string;
  monthId: string;
  canGoForward: boolean;
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
      <div className="mx-5 mt-4 rounded-3xl bg-emerald-500 p-5 text-white">
        <p className="text-sm text-emerald-50">Ingreso total</p>
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onPrev}
              aria-label="Mes anterior"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20"
            >
              ‹
            </button>
            <span className="text-sm font-medium">
              {formatMonthLabel(monthId)}
            </span>
            <button
              type="button"
              onClick={onNext}
              disabled={!canGoForward}
              aria-label="Mes siguiente"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 disabled:opacity-30"
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
              <CategoryRow key={cat} category={cat} month={month} />
            ))}
        <SavingsRow
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
}: {
  category: keyof MonthCaps;
  month: Month;
}) {
  const meta = CATEGORY_META[category];
  const cap = month.capsCents[category];
  const spent = month.spentCents[category];
  const pct = month.distribution[category];
  const status = getCategoryStatus(cap, spent);

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${meta.bar}`} />
          <p className="text-sm font-medium text-stone-900">{meta.label}</p>
        </div>
        <p className="text-xs text-stone-400">
          {pct}% · {formatCents(cap)}
        </p>
      </div>

      {status.isEmpty ? (
        <p className="mt-3 text-sm text-stone-400">
          Aún sin ingresos registrados
        </p>
      ) : (
        <>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-stone-200">
            <div
              className={`h-full rounded-full ${status.overCap ? "bg-red-500" : meta.bar}`}
              style={{ width: `${status.barWidth}%` }}
            />
          </div>

          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-stone-400">{formatCents(spent)} gastado</span>
            <span
              className={
                status.isLow
                  ? "font-medium text-red-600"
                  : "font-medium text-emerald-600"
              }
            >
              {formatCents(status.disponible)} disponible
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function SavingsRow({
  savingsTotalCents,
  contributedThisMonth,
  percentage,
}: {
  savingsTotalCents: number;
  contributedThisMonth: number;
  percentage: number;
}) {
  const meta = CATEGORY_META.ahorro;
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
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showInfo]);

  return (
    <div ref={infoRef} className="relative rounded-2xl border border-stone-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${meta.bar}`} />
          <p className="text-sm font-medium text-stone-900">{meta.label}</p>
        </div>
        <p className="text-xs text-stone-400">
          {percentage}% · {formatCents(contributedThisMonth)}
        </p>
      </div>

      <p className="mt-3 text-2xl font-semibold text-teal-700">
        {formatCents(contributedThisMonth)}
      </p>
      <p className="mt-1 text-xs text-stone-400">este mes</p>

      <div className="mt-3 flex items-center gap-1.5 border-t border-stone-100 pt-3">
        <span className="text-xs text-stone-400">
          Acumulado: {formatCents(savingsTotalCents)}
        </span>
        <button
          type="button"
          onClick={() => setShowInfo((v) => !v)}
          aria-label="Qué es el acumulado"
          className="flex h-4 w-4 items-center justify-center rounded-full bg-stone-200 text-[10px] text-stone-500"
        >
          ?
        </button>
      </div>

      {showInfo && (
        <div className="absolute bottom-full left-4 mb-2 w-56 rounded-xl bg-stone-900 px-3 py-2 text-xs text-white shadow-lg">
          Tu Ahorro nunca se resetea - cada mes se suma más, y solo baja cuando comprás una meta.
        </div>
      )}
    </div>
  );
}
