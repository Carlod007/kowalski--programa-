import { useEffect, useState } from "react";
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
  getTrailingMonths,
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
  const totalSpent =
    month.spentCents.necesidad +
    month.spentCents.ocio +
    month.spentCents.ahorro;
  const topSubcategories = computeTopSubcategories(expenses, TOP_LIMIT);
  const topPaymentMethods = computeTopPaymentMethods(expenses, TOP_LIMIT);
  const maxSubcategoryCents = Math.max(
    0,
    ...topSubcategories.map((i) => i.totalCents),
  );
  const maxPaymentCents = Math.max(
    0,
    ...topPaymentMethods.map((i) => i.totalCents),
  );

  return (
    <>
      <section className="mx-5 mt-6">
        <h2 className="text-sm font-medium text-stone-500">
          Distribución {formatMonthLabel(monthId)}
        </h2>
        <div className="mt-3 flex items-center gap-6">
          <div className="relative h-36 w-36 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
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
            </ResponsiveContainer>
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

      <section className="mx-5 mt-8">
        <h2 className="text-sm font-medium text-stone-500">
          Top subcategorías
        </h2>
        {topSubcategories.length === 0 ? (
          <p className="mt-3 text-sm text-stone-400">Sin gastos este mes</p>
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
          Gasto por método de pago
        </h2>
        {topPaymentMethods.length === 0 ? (
          <p className="mt-3 text-sm text-stone-400">Sin gastos este mes</p>
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
  const [months, setMonths] = useState<TrailingMonth[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getTrailingMonths(userId, endMonthId, 4).then((result) => {
      if (!cancelled) {
        setMonths(result);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [userId, endMonthId]);

  if (loading) return null;
  if (months.length === 0) return null;

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
      <div className="mt-3 h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
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
