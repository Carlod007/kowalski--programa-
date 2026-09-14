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
  computeTopSubcategories,
  computeTopPaymentMethods,
  watchTrailingMonths,
  watchCreditCardPaymentsForRange,
  watchExpensesForMonths,
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
import type { CreditCardPaymentWithId } from "@/types/creditCard";
import {
  classifyOutflow,
  getConsumptionByCategory,
  isConsumptionExpense,
  summarizeOutflows,
} from "@/utils/expenseClassification";
import RankedBar from "@/components/RankedBar";
import BottomNav from "@/components/BottomNav";
import BackButton from "@/components/BackButton";
import {
  getSubcategoryBudgetStatus,
  getSubcategoryConsumptionCents,
} from "@/utils/subcategoryBudgets";
import {
  getAvailableExpenseTags,
  hasExpenseTag,
} from "@/utils/expenseTags";
import {
  formatAnalysisDateRange,
  getAnalysisDateRange,
  getMonthIdsInRange,
  isDateInAnalysisRange,
  validateAnalysisDateRange,
  type AnalysisDateRange,
  type AnalysisPeriodMode,
} from "@/utils/analysisPeriod";

const CURRENT_MONTH_ID = getMonthId();
const TOP_LIMIT = 4;
/** Debe coincidir con las clases h-36 w-36 del contenedor de la torta (9rem). */
const PIE_SIZE = 144;
/** Debe coincidir con la clase h-48 del contenedor de las barras (12rem). */
const BARS_HEIGHT = 192;

export default function ChartsScreen() {
  const user = useAuthStore((s) => s.user);
  const [viewedMonthId, setViewedMonthId] = useState(CURRENT_MONTH_ID);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [periodMode, setPeriodMode] = useState<AnalysisPeriodMode>("month");
  const initialRange = getAnalysisDateRange(CURRENT_MONTH_ID, "month")!;
  const [customFromDate, setCustomFromDate] = useState(initialRange.fromDate);
  const [customToDate, setCustomToDate] = useState(initialRange.toDate);

  if (!user) return null;

  const canGoForward = viewedMonthId < CURRENT_MONTH_ID;
  const customRange = { fromDate: customFromDate, toDate: customToDate };
  const customRangeError =
    periodMode === "custom" ? validateAnalysisDateRange(customRange) : null;
  const selectedRange = getAnalysisDateRange(
    viewedMonthId,
    periodMode,
    customRange,
  );

  const shiftViewedMonth = (delta: number) => {
    const nextMonthId = shiftMonthId(viewedMonthId, delta);
    setViewedMonthId(nextMonthId);
    setSelectedTag(null);
    if (periodMode === "custom") {
      const nextRange = getAnalysisDateRange(nextMonthId, "month")!;
      setCustomFromDate(nextRange.fromDate);
      setCustomToDate(nextRange.toDate);
    }
  };

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
            onClick={() => shiftViewedMonth(-1)}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-stone-200"
          >
            ‹
          </button>
          <span className="text-sm font-medium text-stone-900">
            {formatMonthLabel(viewedMonthId)}
          </span>
          <button
            type="button"
            onClick={() => shiftViewedMonth(1)}
            disabled={!canGoForward}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-stone-200 disabled:opacity-30"
          >
            ›
          </button>
        </div>
      </header>

      <section className="mx-5 mt-5 rounded-2xl border border-stone-200 bg-white p-3">
        <p className="text-xs font-medium text-stone-500">Periodo de análisis</p>
        <div className="mt-2 grid grid-cols-4 gap-1 rounded-xl bg-stone-100 p-1">
          {(
            [
              ["month", "Mes"],
              ["first-half", "1–15"],
              ["second-half", "16–fin"],
              ["custom", "Rango"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                setPeriodMode(mode);
                setSelectedTag(null);
              }}
              className={`rounded-lg px-1 py-1.5 text-xs font-medium ${
                periodMode === mode
                  ? "bg-white text-stone-900 shadow-sm"
                  : "text-stone-500"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {periodMode === "custom" && (
          <div className="mt-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-stone-500">
                Desde
                <input
                  type="date"
                  value={customFromDate}
                  onChange={(event) => {
                    setCustomFromDate(event.target.value);
                    setSelectedTag(null);
                  }}
                  className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-2 py-2 text-sm text-stone-800"
                />
              </label>
              <label className="text-xs text-stone-500">
                Hasta
                <input
                  type="date"
                  value={customToDate}
                  onChange={(event) => {
                    setCustomToDate(event.target.value);
                    setSelectedTag(null);
                  }}
                  className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-2 py-2 text-sm text-stone-800"
                />
              </label>
            </div>
            <p className={`mt-2 text-xs ${customRangeError ? "text-red-600" : "text-stone-400"}`}>
              {customRangeError ??
                "Puedes usar un rango entre una fecha de pago y la siguiente."}
            </p>
          </div>
        )}
      </section>

      {selectedRange ? (
        <MonthAnalytics
          key={`period-${viewedMonthId}-${periodMode}`}
          userId={user.uid}
          monthId={viewedMonthId}
          range={selectedRange}
          periodMode={periodMode}
          selectedTag={selectedTag}
          onSelectedTagChange={setSelectedTag}
        />
      ) : (
        <p className="mx-5 mt-6 text-sm text-stone-400">
          Corrige el rango para ver el análisis.
        </p>
      )}
      {periodMode === "month" && !selectedTag && (
        <TrailingBars
          key={`trailing-${viewedMonthId}`}
          userId={user.uid}
          endMonthId={viewedMonthId}
        />
      )}

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
  range,
  periodMode,
  selectedTag,
  onSelectedTagChange,
}: {
  userId: string;
  monthId: string;
  range: AnalysisDateRange;
  periodMode: AnalysisPeriodMode;
  selectedTag: string | null;
  onSelectedTagChange: (tag: string | null) => void;
}) {
  const userProfile = useAuthStore((state) => state.userProfile);
  const { fromDate, toDate } = range;
  const [month, setMonth] = useState<Month | null>(null);
  const [expenses, setExpenses] = useState<ExpenseTransaction[]>([]);
  const [cardPayments, setCardPayments] = useState<
    CreditCardPaymentWithId[]
  >([]);
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
    const unsubTx = watchExpensesForMonths(
      userId,
      getMonthIdsInRange({ fromDate, toDate }),
      (txs) => {
        if (!active) return;
        setExpenses(txs);
      },
      (error) => console.error("No se pudieron cargar los egresos:", error),
    );
    const unsubCardPayments = watchCreditCardPaymentsForRange(
      userId,
      fromDate,
      toDate,
      (payments) => {
        if (!active) return;
        setCardPayments(payments);
      },
      (error) => console.error("No se pudieron cargar los pagos de tarjetas:", error),
    );

    return () => {
      active = false;
      unsubMonth();
      unsubTx();
      unsubCardPayments();
    };
  }, [userId, monthId, fromDate, toDate]);

  if (loading) {
    return <p className="mt-8 text-center text-stone-400">Cargando...</p>;
  }
  if (!month) {
    return (
      <p className="mt-8 text-center text-stone-400">Sin datos para este mes</p>
    );
  }

  const periodExpenses = expenses.filter((expense) =>
    isDateInAnalysisRange(expense.transactionDate, range),
  );
  const allConsumptionExpenses = periodExpenses.filter(isConsumptionExpense);
  const availableTags = getAvailableExpenseTags(allConsumptionExpenses);
  const consumptionExpenses = allConsumptionExpenses.filter((expense) =>
    hasExpenseTag(expense.tags, selectedTag),
  );
  const consumptionByCategory = getConsumptionByCategory(consumptionExpenses);
  const breakdown = formatCategoryBreakdown(consumptionByCategory);
  const totalConsumption =
    consumptionByCategory.necesidad + consumptionByCategory.ocio;
  // "Todo" compara el consumo de las categorías presupuestadas. Ahorro sigue
  // teniendo su pestaña propia y los pagos de deuda su bloque independiente.
  const filteredExpenses =
    filter === "all"
      ? consumptionExpenses.filter((e) => e.category !== "ahorro")
      : consumptionExpenses.filter((e) => e.category === filter);
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
  const ahorroOutCents = consumptionExpenses
    .filter((e) => e.category === "ahorro")
    .reduce((sum, e) => sum + e.amountCents, 0);
  const originTotals = summarizeOutflows(filteredExpenses);
  const originItems = [
    {
      key: "owned",
      label: "Consumo propio",
      amount: originTotals["owned-consumption"],
      color: "bg-emerald-500",
    },
    {
      key: "loan",
      label: "Con préstamo",
      amount: originTotals["loan-consumption"],
      color: "bg-violet-500",
    },
    {
      key: "card",
      label: "Con tarjeta",
      amount: originTotals["card-consumption"],
      color: "bg-sky-500",
    },
    {
      key: "interest",
      label: "Intereses y cargos",
      amount: originTotals["card-interest"],
      color: "bg-amber-500",
    },
  ].filter((item) => item.amount > 0);
  const originTotal = originItems.reduce((sum, item) => sum + item.amount, 0);
  const loanPaymentCents = periodExpenses
    .filter((expense) => classifyOutflow(expense) === "debt-payment")
    .reduce((sum, expense) => sum + expense.amountCents, 0);
  const cardPaymentCents = cardPayments.reduce(
    (sum, payment) => sum + payment.amountCents,
    0,
  );
  const debtPaymentCents = loanPaymentCents + cardPaymentCents;
  const subcategoryBudgetItems = (userProfile?.subcategoryBudgets ?? [])
    .filter(
      (budget) =>
        filter === "all" ||
        (filter !== "ahorro" && budget.category === filter),
    )
    .map((budget) => {
      const spentCents = getSubcategoryConsumptionCents(periodExpenses, budget);
      return {
        ...budget,
        status: getSubcategoryBudgetStatus(
          budget.monthlyLimitCents,
          spentCents,
        ),
      };
    });

  return (
    <>
      <section className="mx-5 mt-6">
        <h2 className="text-sm font-medium text-stone-500">
          Consumo{" "}
          {periodMode === "month"
            ? formatMonthLabel(monthId)
            : formatAnalysisDateRange(range)}
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
                {formatCents(totalConsumption)}
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
                  {totalConsumption > 0
                    ? Math.round((entry.value / totalConsumption) * 100)
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

      {availableTags.length > 0 && (
        <div className="mx-5 mt-3 flex gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => onSelectedTagChange(null)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium ${
              selectedTag === null
                ? "border-stone-800 bg-stone-800 text-white"
                : "border-stone-200 bg-white text-stone-500"
            }`}
          >
            Todas las etiquetas
          </button>
          {availableTags.map((tag) => (
            <button
              key={tag.toLocaleLowerCase("es")}
              type="button"
              onClick={() => onSelectedTagChange(tag)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium ${
                selectedTag?.toLocaleLowerCase("es") ===
                tag.toLocaleLowerCase("es")
                  ? "border-teal-600 bg-teal-50 text-teal-700"
                  : "border-stone-200 bg-white text-stone-500"
              }`}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

      {!isAhorro && (
        <section className="mx-5 mt-6">
          <h2 className="text-sm font-medium text-stone-500">
            Origen del consumo
          </h2>
          {originItems.length === 0 ? (
            <p className="mt-3 text-sm text-stone-400">
              Sin consumo en este periodo
            </p>
          ) : (
            <div className="mt-3 rounded-2xl border border-stone-200 bg-white p-4">
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-stone-100">
                {originItems.map((item) => (
                  <span
                    key={item.key}
                    className={item.color}
                    style={{ width: `${(item.amount / originTotal) * 100}%` }}
                  />
                ))}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {originItems.map((item) => (
                  <div key={item.key}>
                    <p className="flex items-center gap-1.5 text-xs text-stone-400">
                      <span className={`h-2 w-2 rounded-full ${item.color}`} />
                      {item.label}
                    </p>
                    <p className="mt-0.5 text-sm font-medium text-stone-900">
                      {formatCents(item.amount)}
                    </p>
                  </div>
                ))}
              </div>
              {originTotals["card-consumption"] > 0 && (
                <p className="mt-3 text-xs text-stone-400">
                  La tarjeta representa consumo y deuda; no aumenta tu dinero disponible.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {!isAhorro &&
        periodMode === "month" &&
        !selectedTag &&
        subcategoryBudgetItems.length > 0 && (
          <section className="mx-5 mt-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium text-stone-500">
                Presupuestos por subcategoría
              </h2>
              <Link
                to="/subcategory-budgets"
                className="text-xs font-medium text-teal-600"
              >
                Configurar
              </Link>
            </div>
            <div className="mt-3 flex flex-col gap-3">
              {subcategoryBudgetItems.map((item) => (
                <div
                  key={`${item.category}:${item.subcategory}`}
                  className="rounded-2xl border border-stone-200 bg-white p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-stone-800">
                        {item.subcategory}
                      </p>
                      {filter === "all" && (
                        <p className="text-xs text-stone-400">
                          {CATEGORY_META[item.category].label}
                        </p>
                      )}
                    </div>
                    <p className="text-xs text-stone-500">
                      {formatCents(item.status.spentCents)} de{" "}
                      {formatCents(item.monthlyLimitCents)}
                    </p>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-100">
                    <div
                      className={`h-full rounded-full ${
                        item.status.level === "exceeded"
                          ? "bg-red-500"
                          : item.status.level === "near"
                            ? "bg-amber-500"
                            : CATEGORY_META[item.category].bar
                      }`}
                      style={{
                        width: `${Math.min(100, item.status.percentage)}%`,
                      }}
                    />
                  </div>
                  <p
                    className={`mt-2 text-xs ${
                      item.status.level === "exceeded"
                        ? "font-medium text-red-600"
                        : item.status.level === "near"
                          ? "font-medium text-amber-700"
                          : "text-stone-400"
                    }`}
                  >
                    {item.status.level === "exceeded"
                      ? `Excedido por ${formatCents(-item.status.remainingCents)}`
                      : item.status.level === "near"
                        ? `${item.status.percentage}% utilizado`
                        : `${formatCents(item.status.remainingCents)} disponible`}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

      {!selectedTag && (
        <section className="mx-5 mt-6">
          <h2 className="text-sm font-medium text-stone-500">
            Pagos de deudas del periodo
          </h2>
          <div className="mt-3 rounded-2xl border border-stone-200 bg-white p-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-stone-400">Préstamos</p>
                <p className="mt-0.5 font-medium text-stone-900">
                  {formatCents(loanPaymentCents)}
                </p>
              </div>
              <div>
                <p className="text-xs text-stone-400">Tarjetas</p>
                <p className="mt-0.5 font-medium text-stone-900">
                  {formatCents(cardPaymentCents)}
                </p>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-stone-100 pt-3">
              <span className="text-xs text-stone-500">Total pagado</span>
              <span className="font-semibold text-stone-900">
                {formatCents(debtPaymentCents)}
              </span>
            </div>
            <p className="mt-2 text-xs text-stone-400">
              Reduce la deuda, pero no se vuelve a sumar como consumo.
            </p>
          </div>
        </section>
      )}

      {/* Acá solo va lo que esta pantalla explica mejor que ninguna otra: en
          qué se usó el ahorro. Cuánto entró se muestra en Ver detalle, que
          además lo desglosa - repetirlo acá no agregaba nada. */}
      {isAhorro && (
        <section className="mx-5 mt-6">
          <div className="rounded-2xl border border-stone-200 bg-white p-4">
            <p className="text-xs text-stone-400">Ahorro usado en el periodo</p>
            <p className="mt-0.5 text-xl font-semibold text-red-600">
              -{formatCents(ahorroOutCents)}
            </p>
            <p className="mt-1 text-xs text-stone-400">
              Compras de metas y retiros de fondos hechos en el periodo. No refleja
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
          {isAhorro ? "En qué usaste el ahorro en el periodo" : "Top subcategorías"}
        </h2>
        {topSubcategories.length === 0 ? (
          <p className="mt-3 text-sm text-stone-400">
            {isAhorro
              ? "No usaste ahorro en el periodo"
              : "Sin gastos en el periodo"}
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
              ? "No usaste ahorro en el periodo"
              : "Sin gastos en el periodo"}
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
    Consumo: m.expenseCents / 100,
  }));

  return (
    <section className="mx-5 mt-8">
      <h2 className="text-sm font-medium text-stone-500">
        Ingresos vs consumo
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
            <Bar dataKey="Consumo" fill="#ef4444" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex items-center justify-center gap-4 text-xs">
        <span className="flex items-center gap-1.5 text-stone-600">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Ingresos
        </span>
        <span className="flex items-center gap-1.5 text-stone-600">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Consumo
        </span>
      </div>
    </section>
  );
}
