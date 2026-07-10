import { useEffect, useState, type ComponentType } from "react";
import { Link, NavLink } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/store/authStore";
import { checkAndCloseMonth } from "@/services/monthService";
import { getMonthId, shiftMonthId, formatMonthLabel } from "@/utils/date";
import { formatCents } from "@/utils/currency";
import {
  CATEGORY_ORDER,
  CATEGORY_META,
  getCategoryStatus,
} from "@/utils/category";
import type { Month } from "@/types/month";
import type { Category } from "@/types/transaction";

const CURRENT_MONTH_ID = getMonthId(); // fijo: el mes real de hoy, no cambia al navegar

export default function Dashboard() {
  const user = useAuthStore((s) => s.user);
  const userProfile = useAuthStore((s) => s.userProfile);
  const [viewedMonthId, setViewedMonthId] = useState(CURRENT_MONTH_ID);

  // Corre una sola vez, sobre el mes real — nunca sobre el mes que se está navegando
  useEffect(() => {
    if (!user) return;
    checkAndCloseMonth(user.uid).catch((err) => {
      console.error("checkAndCloseMonth falló:", err);
    });
  }, [user]);

  if (!user) return null; // ProtectedLayout ya garantiza esto, es solo para que TS no se queje abajo

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
        <Link
          to="/settings"
          aria-label="Ajustes"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-stone-200 text-stone-500"
        >
          ⚙
        </Link>
      </header>

      <MonthSummary
        key={viewedMonthId}
        userId={user.uid}
        monthId={viewedMonthId}
        canGoForward={canGoForward}
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
  onPrev,
  onNext,
}: {
  userId: string;
  monthId: string;
  canGoForward: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const [month, setMonth] = useState<Month | null>(null);
  const [loading, setLoading] = useState(true); // valor inicial — no se vuelve a forzar a mano

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
          CATEGORY_ORDER.map((cat) => (
            <CategoryRow key={cat} category={cat} month={month} />
          ))
        )}
      </main>
    </>
  );
}

function CategoryRow({
  category,
  month,
}: {
  category: Category;
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

function BottomNav() {
  const items: {
    to: string;
    label: string;
    icon: ComponentType<{ active: boolean }>;
  }[] = [
    { to: "/dashboard", label: "Inicio", icon: HomeIcon },
    { to: "/history", label: "Historial", icon: ListIcon },
    { to: "/charts", label: "Análisis", icon: ChartIcon },
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 flex border-t border-stone-200 bg-white">
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center gap-1 py-3 text-xs ${
              isActive ? "text-emerald-600" : "text-stone-400"
            }`
          }
        >
          {({ isActive }) => (
            <>
              <Icon active={isActive} />
              {label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2.5 : 2}
    >
      <path
        d="M3 11.5 12 4l9 7.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ListIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2.5 : 2}
    >
      <circle cx="4" cy="6" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="18" r="1" />
      <path d="M9 6h11M9 12h11M9 18h11" strokeLinecap="round" />
    </svg>
  );
}

function ChartIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2.5 : 2}
    >
      <path
        d="M5 20V10M12 20V4M19 20v-7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
