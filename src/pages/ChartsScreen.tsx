import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  Tooltip,
} from "recharts";
import { useAuthStore } from "@/store/authStore";
import {
  formatCategoryBreakdown,
  getMonthExpenses,
  computeTopSubcategories,
  computeTopPaymentMethods,
  watchTrailingMonths,
  type TrailingMonth,
} from "@/services/analyticsService";
import {
  getMonthId,
  shiftMonthId,
  formatMonthLabel,
  formatMonthShortLabel,
} from "@/utils/date";
import { formatCents } from "@/utils/currency";
import { CATEGORY_META } from "@/utils/category";
import type { Month } from "@/types/month";
import type { ExpenseTransaction } from "@/types/transaction";
import RankedBar from "@/components/RankedBar";
import BottomNav from "@/components/BottomNav";
import BackButton from "@/components/BackButton";

const CURRENT_MONTH_ID = getMonthId();
const TOP_LIMIT = 4;
/** Debe coincidir con las clases h-36 w-36 del contenedor de la torta (9rem). */
const PIE_SIZE = 144;
/** Debe coincidir con la clase h-48 del contenedor de las barras (12rem). */
const BARS_HEIGHT = 192;

export default function ChartsScreen() {
  const user = useAuthStore((s) => s.user);
  const [viewedMonthId, setViewedMonthId] = useState(CURRENT_MONTH_ID);

  if (!user) return null;

  const canGoForward = viewedMonthId < CURRENT_MONTH_ID;

  return (
    <div className="min-h-dvh bg-stone-50 pb-24">
      <header className="flex items-center justify-between px-5 pt-8">
        <div className="flex items-center gap-3">
          <BackButton to="/dashboard" />
          <h1 className="text-xl font-semibold text-stone-900">Análisis</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setViewedMonthId((id) => shiftMonthId(id, -1))}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-stone-200"
          >
            ‹
          </button>
          <span className="text-sm font-medium text-stone-900">
            {formatMonthLabel(viewedMonthId)}
          </span>
          <button
            type="button"
            onClick={() => setViewedMonthId((id) => shiftMonthId(id, 1))}
            disabled={!canGoForward}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-stone-200 disabled:opacity-30"
          >
            ›
          </button>
        </div>
      </header>

      <MonthAnalytics
        key={`month-${viewedMonthId}`}
        userId={user.uid}
        monthId={viewedMonthId}
      />
      <TrailingBars
        key={`trailing-${viewedMonthId}`}
        userId={user.uid}
        endMonthId={viewedMonthId}
      />

      <BottomNav />
    </div>
  );
}

type CategoryFilter = "all" | "necesidad" | "ocio" | "ahorro";

const FILTER_TABS: { value: CategoryFilter; label: string }[] = [
  { value: "all", label: "Todo" },
  { value: "necesidad", label: "Necesidad" },
  { value: "ocio", label: "Ocio" },
  { value: "ahorro", label: "Ahorro" },
];

function CategoryTabs({
  value,
  onChange,
}: {
  value: CategoryFilter;
  onChange: (v: CategoryFilter) => void;
}) {
  return (
    <div className="flex gap-1.5 rounded-full bg-stone-100 p-1">
      {FILTER_TABS.map((tab) => {
        const isActive = value === tab.value;
        const activeBg =
          tab.value === "all" ? "bg-stone-900" : CATEGORY_META[tab.value].bar;
        return (
          <button
            key={tab.value}
            type="button"
            onClick={() => onChange(tab.value)}
            className={`flex-1 rounded-full py-1.5 text-xs font-medium transition-colors ${
              isActive ? `${activeBg} text-white` : "text-stone-500"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function MonthAnalytics({
  userId,
  monthId,
}: {
  userId: string;
  monthId: string;
}) {
  const [month, setMonth] = useState<Month | null>(null);
  const [expenses, setExpenses] = useState<ExpenseTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<CategoryFilter>("all");

  useEffect(() => {
    let active = true;
    const monthRef = doc(db, "users", userId, "months", monthId);
    const unsubMonth = onSnapshot(monthRef, (snap) => {
      if (!active) return;
      setMonth(snap.exists() ? (snap.data() as Month) : null);
      setLoading(false);
    });
    const unsubTx = getMonthExpenses(userId, monthId, (txs) => {
      if (!active) return;
      setExpenses(txs);
    });

    return () => {
      active = false;
      unsubMonth();
      unsubTx();
    };
  }, [userId, monthId]);

  if (loading) {
    return <p className="mt-8 text-center text-stone-400">Cargando...</p>;
  }
  if (!month) {
    return (
      <p className="mt-8 text-center text-stone-400">Sin datos para este mes</p>
    );
  }

  const breakdown = formatCategoryBreakdown(month.spentCents);
  const totalSpent = month.spentCents.necesidad + month.spentCents.ocio;
  // "Todo" es la vista de gasto contra topes, así que deja fuera el ahorro:
  // usarlo no consume tope de ningún mes. Con la pestaña Ahorro sí se mira.
  const filteredExpenses =
    filter === "all"
      ? expenses.filter((e) => e.category !== "ahorro")
      : expenses.filter((e) => e.category === filter);
  const topSubcategories = computeTopSubcategories(filteredExpenses, TOP_LIMIT);
  const topPaymentMethods = computeTopPaymentMethods(
    filteredExpenses,
    TOP_LIMIT,
  );
  const maxSubcategoryCents = Math.max(
    0,
    ...topSubcategories.map((i) => i.totalCents),
  );
  const maxPaymentCents = Math.max(
    0,
    ...topPaymentMethods.map((i) => i.totalCents),
  );
  // Las compras de metas y los retiros del fondo ya se guardan como egresos
  // con categoría "ahorro": no hay que calcular nada nuevo, solo mirarlos.
  const isAhorro = filter === "ahorro";
  const ahorroOutCents = expenses
    .filter((e) => e.category === "ahorro")
    .reduce((sum, e) => sum + e.amountCents, 0);

  return (
    <>
      <section className="mx-5 mt-6">
        <h2 className="text-sm font-medium text-stone-500">
          Distribución {formatMonthLabel(monthId)}
        </h2>
        <div className="mt-3 flex items-center gap-6">
          {/* Tamaño fijo: no hace falta medir el contenedor. Medirlo hacía que
              recharts avisara por consola cuando React monta dos veces en
              desarrollo (StrictMode) y todavía no hay layout. */}
          <div className="relative h-36 w-36 shrink-0">
            <PieChart width={PIE_SIZE} height={PIE_SIZE}>
              <Pie
                data={breakdown}
                dataKey="value"
                innerRadius={45}
                outerRadius={65}
                paddingAngle={2}
              >
                {breakdown.map((entry) => (
                  <Cell key={entry.category} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-base font-semibold text-stone-900">
                {formatCents(totalSpent)}
              </span>
              <span className="text-xs text-stone-400">gastado</span>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {breakdown.map((entry) => (
              <div
                key={entry.category}
                className="flex items-center gap-2 text-sm"
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: entry.color }}
                />
                <span className="text-stone-700">
                  {entry.label}{" "}
                  {totalSpent > 0
                    ? Math.round((entry.value / totalSpent) * 100)
                    : 0}
                  %
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="mx-5 mt-6">
        <CategoryTabs value={filter} onChange={setFilter} />
      </div>

      {/* Acá solo va lo que esta pantalla explica mejor que ninguna otra: en
          qué se usó el ahorro. Cuánto entró se muestra en Ver detalle, que
          además lo desglosa - repetirlo acá no agregaba nada. */}
      {isAhorro && (
        <section className="mx-5 mt-6">
          <div className="rounded-2xl border border-stone-200 bg-white p-4">
            <p className="text-xs text-stone-400">Ahorro usado este mes</p>
            <p className="mt-0.5 text-xl font-semibold text-red-600">
              -{formatCents(ahorroOutCents)}
            </p>
            <p className="mt-1 text-xs text-stone-400">
              Compras de metas y retiros de fondos hechos este mes. No refleja
              cuánto tiene asignado cada meta hoy.
            </p>
            <Link
              to="/movements"
              className="mt-3 inline-block text-xs font-medium text-teal-600"
            >
              Ver cuánto entró al ahorro →
            </Link>
          </div>
        </section>
      )}

      <section className="mx-5 mt-8">
        <h2 className="text-sm font-medium text-stone-500">
          {isAhorro ? "En qué usaste el ahorro este mes" : "Top subcategorías"}
        </h2>
        {topSubcategories.length === 0 ? (
          <p className="mt-3 text-sm text-stone-400">
            {isAhorro
              ? "No usaste ahorro este mes"
              : "Sin gastos este mes"}
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-4">
            {topSubcategories.map((item) => (
              <RankedBar
                key={`${item.category}::${item.subcategory}`}
                label={item.subcategory}
                valueCents={item.totalCents}
                maxCents={maxSubcategoryCents}
                colorClass={CATEGORY_META[item.category].bar}
              />
            ))}
          </div>
        )}
      </section>

      <section className="mx-5 mt-8">
        <h2 className="text-sm font-medium text-stone-500">
          {isAhorro ? "Por dónde salió" : "Gasto por método de pago"}
        </h2>
        {topPaymentMethods.length === 0 ? (
          <p className="mt-3 text-sm text-stone-400">
            {isAhorro
              ? "No usaste ahorro este mes"
              : "Sin gastos este mes"}
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-4">
            {topPaymentMethods.map((item) => (
              <RankedBar
                key={item.paymentMethod}
                label={item.paymentMethod}
                valueCents={item.totalCents}
                maxCents={maxPaymentCents}
                colorClass="bg-stone-400"
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function TrailingBars({
  userId,
  endMonthId,
}: {
  userId: string;
  endMonthId: string;
}) {
  const [months, setMonths] = useState<TrailingMonth[] | null>(null);

  useEffect(() => {
    const unsubscribe = watchTrailingMonths(userId, endMonthId, 4, setMonths);
    return () => unsubscribe();
  }, [userId, endMonthId]);

  if (months === null || months.length === 0) return null;

  const chartData = months.map((m) => ({
    monthId: m.monthId,
    label: formatMonthShortLabel(m.monthId),
    Ingresos: m.totalIncomeCents / 100,
    Egresos: m.expenseCents / 100,
  }));

  return (
    <section className="mx-5 mt-8">
      <h2 className="text-sm font-medium text-stone-500">
        Ingresos vs egresos
      </h2>
      {/* El ancho sigue siendo responsivo; la altura va en píxeles porque ya
          era fija. Con una medida positiva desde el primer render, recharts
          deja de avisar por consola mientras React monta dos veces en
          desarrollo (StrictMode). */}
      <div className="mt-3 w-full">
        <ResponsiveContainer width="100%" height={BARS_HEIGHT}>
          <BarChart data={chartData}>
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              fontSize={12}
            />
            <Tooltip
              formatter={(value) =>
                formatCents(Math.round(Number(value) * 100))
              }
            />
            <Bar dataKey="Ingresos" fill="#10b981" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Egresos" fill="#ef4444" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex items-center justify-center gap-4 text-xs">
        <span className="flex items-center gap-1.5 text-stone-600">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Ingresos
        </span>
        <span className="flex items-center gap-1.5 text-stone-600">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Egresos
        </span>
      </div>
    </section>
  );
}
