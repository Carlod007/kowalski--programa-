import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/store/authStore";
import { confirmMonthClose, moveSurplus } from "@/services/monthService";
import { checkAndRememberMonthClosing } from "@/services/monthClosingNoticeService";
import AutomaticMonthClosingSummary from "@/components/AutomaticMonthClosingSummary";
import DistributionMismatchBanner from "@/components/DistributionMismatchBanner";
import { getMonthInitialSplit } from "@/services/movementService";
import { watchLoans } from "@/services/loanService";
import { watchCreditCards } from "@/services/creditCardService";
import { getMonthExpenses } from "@/services/analyticsService";
import { useAhorroBreakdown } from "@/hooks/useAhorroBreakdown";
import { useCurrentMonthId } from "@/hooks/useCurrentMonthId";
import { getAssignableCents, getUnassignedCents } from "@/utils/savings";
import {
  shiftMonthId,
  formatMonthLabel,
  formatMonthLongLabel,
} from "@/utils/date";
import {
  getGraceDeadlineDate,
  isWithinGraceWindow,
} from "@/utils/transactionTiming";
import { getMonthRemainders } from "@/utils/monthRemainders";
import { formatCents } from "@/utils/currency";
import {
  CAP_CATEGORY_ORDER,
  CATEGORY_META,
  getCategoryDisplayBalance,
  getCategoryStatus,
} from "@/utils/category";
import type { DeficitResolution, Month, MonthCaps } from "@/types/month";
import type {
  Distribution,
  ExpenseTransaction,
} from "@/types/transaction";
import type { MovementWithId } from "@/services/movementService";
import type { LoanWithId } from "@/types/loan";
import type { CreditCardWithId } from "@/types/creditCard";
import {
  getLoanInstallmentStatus,
  getLoanOutstandingCents,
  getNextPendingInstallment,
} from "@/utils/loans";
import {
  getAvailableCreditCents,
  getCreditCardStatementStatus,
} from "@/utils/creditCards";
import { toDateInputValue, formatDateLabel } from "@/utils/date";
import { summarizeOutflows } from "@/utils/expenseClassification";
import BottomNav from "@/components/BottomNav";
import MovementRow from "@/components/MovementRow";
import CategoryIcon from "@/components/CategoryIcon";
import MaskIcon from "@/components/MaskIcon";
import loanIcon from "@/assets/icons/loan.svg";
import creditCardIcon from "@/assets/icons/credit-card.svg";

type CategoryKey = "necesidad" | "ocio" | "ahorro";

export default function Dashboard() {
  const user = useAuthStore((s) => s.user);
  const userProfile = useAuthStore((s) => s.userProfile);
  const currentMonthId = useCurrentMonthId({
    userId: user?.uid,
    timeZone: userProfile?.timeZone,
    onMonthChange: (nextMonthId, prevMonthId) => {
      setViewedMonthId((current) =>
        current === prevMonthId ? nextMonthId : current,
      );
      if (user) {
        checkAndRememberMonthClosing(user.uid).catch((err) => {
          console.error("checkAndCloseMonth falló:", err);
        });
      }
    },
  });
  const [viewedMonthId, setViewedMonthId] = useState(currentMonthId);

  const hasCheckedClose = useRef(false);

  useEffect(() => {
    if (!user || hasCheckedClose.current) return;
    hasCheckedClose.current = true;
    checkAndRememberMonthClosing(user.uid).catch((err) => {
      console.error("checkAndCloseMonth falló:", err);
    });
  }, [user]);

  if (!user) return null;

  const canGoForward = viewedMonthId < currentMonthId;
  const isViewingCurrentMonth = viewedMonthId === currentMonthId;
  const essentialNeedsTotalCents = (userProfile?.essentialNeeds ?? []).reduce(
    (sum, n) => sum + n.monthlyAmountCents,
    0,
  );
  // Del ahorro solo se puede sacar lo que no está reservado para una meta.
  const assignableCents = getAssignableCents(
    userProfile?.savingsTotalCents ?? 0,
    userProfile?.savingsGoals ?? [],
  );

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

      <AutomaticMonthClosingSummary
        key={user.uid}
        userId={user.uid}
        unseenClosedMonthId={userProfile?.unseenClosedMonthId}
      />

      {userProfile?.pendingCloseMonthId &&
        userProfile.pendingCloseMonthId === shiftMonthId(currentMonthId, -1) &&
        isWithinGraceWindow() && (
          <PendingCloseGraceBanner
            userId={user.uid}
            pendingMonthId={userProfile.pendingCloseMonthId}
            unassignedSavingsCents={assignableCents}
          />
        )}

      <MonthSummary
        key={viewedMonthId}
        userId={user.uid}
        monthId={viewedMonthId}
        canGoForward={canGoForward}
        isCurrentMonth={isViewingCurrentMonth}
        profileDistribution={userProfile?.distribution}
        savingsTotalCents={userProfile?.savingsTotalCents ?? 0}
        accumulatedCents={userProfile?.savingsTotalCents ?? null}
        unassignedCents={userProfile
          ? getUnassignedCents(userProfile.savingsTotalCents, userProfile.savingsGoals ?? [])
          : null}
        assignableCents={assignableCents}
        essentialNeedsTotalCents={essentialNeedsTotalCents}
        onPrev={() => setViewedMonthId((id) => shiftMonthId(id, -1))}
        onNext={() => setViewedMonthId((id) => shiftMonthId(id, 1))}
      />

      <BottomNav />
    </div>
  );
}

function MonthSummary({
  userId,
  monthId,
  canGoForward,
  isCurrentMonth,
  profileDistribution,
  savingsTotalCents,
  accumulatedCents,
  unassignedCents,
  assignableCents,
  essentialNeedsTotalCents,
  onPrev,
  onNext,
}: {
  userId: string;
  monthId: string;
  canGoForward: boolean;
  isCurrentMonth: boolean;
  profileDistribution?: Distribution;
  savingsTotalCents: number;
  accumulatedCents: number | null;
  unassignedCents: number | null;
  assignableCents: number;
  essentialNeedsTotalCents: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const [month, setMonth] = useState<Month | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialSplit, setInitialSplit] = useState<Distribution | null>(null);
  const [initialSplitDeterminable, setInitialSplitDeterminable] =
    useState(true);
  const [showMovementsModal, setShowMovementsModal] = useState(false);
  const [expenses, setExpenses] = useState<ExpenseTransaction[] | null>(null);
  const [outflowSyncing, setOutflowSyncing] = useState(false);

  useEffect(() => {
    let latestMonth: Month | null | undefined;
    let latestExpenses: ExpenseTransaction[] | null | undefined;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    function totalsMatch() {
      if (!latestMonth || !latestExpenses) return true;
      const totals = { necesidad: 0, ocio: 0 };
      for (const expense of latestExpenses) {
        if (expense.category === "necesidad" || expense.category === "ocio") {
          totals[expense.category] += expense.amountCents;
        }
      }
      return (
        totals.necesidad === latestMonth.spentCents.necesidad &&
        totals.ocio === latestMonth.spentCents.ocio
      );
    }

    function publish(force = false) {
      if (
        disposed ||
        latestMonth === undefined ||
        latestExpenses === undefined
      ) {
        return;
      }
      if (!force && !totalsMatch()) {
        setOutflowSyncing(true);
        if (!fallbackTimer) {
          fallbackTimer = setTimeout(() => {
            fallbackTimer = null;
            publish(true);
          }, 3_000);
        }
        return;
      }
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      setMonth(latestMonth);
      setExpenses(latestExpenses);
      setOutflowSyncing(false);
      setLoading(false);
    }

    const monthRef = doc(db, "users", userId, "months", monthId);
    const monthUnsubscribe = onSnapshot(
      monthRef,
      (snap) => {
        latestMonth = snap.exists() ? (snap.data() as Month) : null;
        publish();
      },
      (err) => {
        console.error("onSnapshot mes falló:", err);
        latestMonth = null;
        latestExpenses = [];
        publish(true);
      },
    );
    const expensesUnsubscribe = getMonthExpenses(
      userId,
      monthId,
      (nextExpenses) => {
        latestExpenses = nextExpenses;
        publish();
      },
      (err) => {
        console.error("No se pudo cargar el origen de los gastos:", err);
        latestExpenses = null;
        publish(true);
      },
    );

    return () => {
      disposed = true;
      monthUnsubscribe();
      expensesUnsubscribe();
      if (fallbackTimer) clearTimeout(fallbackTimer);
    };
  }, [userId, monthId]);

  useEffect(() => {
    const unsubscribe = getMonthInitialSplit(userId, monthId, (split) => {
      setInitialSplit(split);
      setInitialSplitDeterminable(split !== null);
    });
    return () => unsubscribe();
  }, [userId, monthId]);

  const {
    movements,
    initialSplitAhorroCents,
    isInitialSplitDeterminable,
    isMixedSplit,
    inflowsCents,
    netFlowCents,
    netContributionCents,
    ahorroActualPct,
    isAhorroActualDeterminable,
    envelopeDeficitWarning,
  } = useAhorroBreakdown(
    userId,
    monthId,
    month?.ahorroContributedCents ?? 0,
    month?.totalIncomeCents ?? 0,
    month?.directSavingsCents ?? 0,
    month?.distribution,
    month,
    expenses,
  );

  return (
    <>
      {isCurrentMonth && month && (
        <DistributionMismatchBanner
          monthDistribution={month.distribution}
          profileDistribution={profileDistribution}
          className="mx-5 mt-4"
        />
      )}

      <div className="mx-5 mt-4 rounded-3xl bg-emerald-600 p-5 text-white">
        <p className="text-sm text-emerald-50">Ingreso total del mes</p>
        <p className="mt-1 text-3xl font-semibold">
          {loading ? "···" : formatCents(month?.totalIncomeCents ?? 0)}
        </p>
        {/* Se muestra aparte, no sumado arriba: el total de arriba es la base
            de los porcentajes, y un aporte directo nunca se repartió. */}
        {(month?.directSavingsCents ?? 0) > 0 && (
          <p className="mt-1 text-sm text-emerald-50">
            + {formatCents(month?.directSavingsCents ?? 0)} directo a Ahorro
          </p>
        )}
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

      {isCurrentMonth && (
        <>
          <div className="mt-4 flex gap-3 px-5">
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

          <section className="mt-4 px-5" aria-labelledby="funds-to-pay-title">
            <h2
              id="funds-to-pay-title"
              className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500"
            >
              Fondos para pagar
            </h2>
            <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
              <LoanSummaryCard userId={userId} />
              <CreditCardSummaryCard userId={userId} />
            </div>
          </section>
        </>
      )}

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
                essentialNeedsTotalCents={essentialNeedsTotalCents}
                initialSplit={initialSplit}
                initialSplitDeterminable={initialSplitDeterminable}
                isMixedSplit={isMixedSplit}
                movements={movements}
                expenses={expenses}
                outflowSyncing={outflowSyncing}
              />
            ))}
            <SavingsRow
              userId={userId}
              monthId={monthId}
              isCurrentMonth={isCurrentMonth}
              capsCents={month.capsCents}
              savingsTotalCents={savingsTotalCents}
              accumulatedCents={accumulatedCents}
              unassignedCents={unassignedCents}
              assignableCents={assignableCents}
              monthlyNetCents={netFlowCents}
              contributedThisMonth={inflowsCents ?? month.ahorroContributedCents}
              percentage={month.distribution.ahorro}
              initialSplitAhorroCents={initialSplitAhorroCents}
              isInitialSplitDeterminable={isInitialSplitDeterminable}
              isMixedSplit={isMixedSplit}
              netContributionCents={netContributionCents}
              ahorroActualPct={ahorroActualPct}
              isAhorroActualDeterminable={isAhorroActualDeterminable}
              envelopeDeficitWarning={envelopeDeficitWarning}
            />
            <button
              type="button"
              onClick={() => setShowMovementsModal(true)}
              className="flex items-center justify-between rounded-2xl border border-stone-200 bg-white px-4 py-3 text-left"
            >
              <span className="text-sm font-medium text-stone-900">
                Movimientos de excedentes
              </span>
              <span className="text-xs font-medium text-teal-600">Ver →</span>
            </button>
          </>
        )}
      </main>

      {showMovementsModal && (
        <MovementsModal
          movements={movements}
          onClose={() => setShowMovementsModal(false)}
        />
      )}
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
  essentialNeedsTotalCents,
  initialSplit,
  initialSplitDeterminable,
  isMixedSplit,
  movements,
  expenses,
  outflowSyncing,
}: {
  category: keyof MonthCaps;
  month: Month;
  userId: string;
  monthId: string;
  isCurrentMonth: boolean;
  savingsTotalCents: number;
  essentialNeedsTotalCents: number;
  initialSplit: Distribution | null;
  initialSplitDeterminable: boolean;
  isMixedSplit: boolean;
  movements: MovementWithId[];
  expenses: ExpenseTransaction[] | null;
  outflowSyncing: boolean;
}) {
  const meta = CATEGORY_META[category];
  const cap = month.capsCents[category];
  const spent = month.spentCents[category];
  const borrowedCap = month.borrowedCapsCents?.[category] ?? 0;
  const loanFundedSpent = month.loanFundedSpentCents?.[category] ?? 0;
  const carriedDeficit =
    category === "necesidad" ? (month.carriedDeficitCents ?? 0) : 0;
  const ownedCap = cap - borrowedCap;
  const ownedSpent = spent - loanFundedSpent;
  const movableSurplus = ownedCap - ownedSpent - carriedDeficit;
  const pct = month.distribution[category];
  const status = getCategoryStatus(ownedCap, ownedSpent + carriedDeficit);
  const displayBalance = getCategoryDisplayBalance(category, month);
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

  // El botón se muestra siempre en el mes actual: si no queda excedente, se
  // explica al pulsarlo en vez de desaparecer sin motivo aparente.
  const hasSurplus = movableSurplus > 0;

  const destinations: CategoryKey[] =
    category === "necesidad" ? ["ocio", "ahorro"] : ["necesidad", "ahorro"];

  // Reparto inicial real: suma de lo que quedó guardado en cada transacción
  // de ingreso (no un cálculo aproximado), así que la comparación es exacta
  // - cualquier diferencia, aunque sea de 1 centavo, es un ajuste real (un
  // excedente heredado del mes anterior o un movimiento entre categorías),
  // nunca una suposición por redondeo.
  const realInitialCap = initialSplit ? initialSplit[category] : null;
  const capWasAdjusted = realInitialCap !== null && ownedCap !== realInitialCap;
  const inheritedCategoryCents =
    category === "necesidad"
      ? (month.inheritedNecesidadCents ?? 0)
      : category === "ocio"
        ? (month.inheritedOcioCents ?? 0)
        : 0;
  const categoryMovementsDelta = movements.reduce((sum, m) => {
    if (m.kind === "closed_month_adjustment") {
      return m.category === category ? sum + (m.deltaCents ?? 0) : sum;
    }
    if (m.destination === category) return sum + m.amountCents;
    if (m.origin === category) return sum - m.amountCents;
    return sum;
  }, 0);
  const hasCategoryMovements = movements.some((m) =>
    m.kind === "closed_month_adjustment"
      ? m.category === category
      : m.destination === category || m.origin === category,
  );
  const resolvedInheritedCents =
    category === "necesidad"
      ? month.inheritedNecesidadCents !== undefined
        ? month.inheritedNecesidadCents
        : realInitialCap !== null
          ? Math.max(0, ownedCap - realInitialCap - categoryMovementsDelta)
          : 0
      : category === "ocio"
        ? (month.inheritedOcioCents ?? 0)
        : 0;
  const showCategoryFormula =
    (category === "necesidad" || category === "ocio") &&
    initialSplitDeterminable &&
    realInitialCap !== null &&
    (resolvedInheritedCents > 0 ||
      hasCategoryMovements ||
      capWasAdjusted);
  const actualPct =
    month.totalIncomeCents > 0
      ? ((ownedCap / month.totalIncomeCents) * 100).toFixed(1)
      : "0.0";
  const classified =
    expenses === null
      ? null
      : summarizeOutflows(
          expenses.filter((expense) => expense.category === category),
        );
  const classifiedTotal = classified
    ? Object.values(classified).reduce((sum, amount) => sum + amount, 0)
    : 0;
  const unclassifiedHistorical = Math.max(0, spent - classifiedTotal);
  const sourceItems = classified
    ? [
        {
          key: "owned",
          label: "Propio",
          amount: classified["owned-consumption"],
          color: "bg-emerald-500",
        },
        {
          key: "loan",
          label: "Préstamo",
          amount: classified["loan-consumption"],
          color: "bg-violet-500",
        },
        {
          key: "card",
          label: "Tarjeta",
          amount: classified["card-consumption"],
          color: "bg-sky-500",
        },
        {
          key: "interest",
          label: "Intereses",
          amount: classified["card-interest"],
          color: "bg-amber-500",
        },
        {
          key: "debt",
          label: "Deuda",
          amount: classified["debt-payment"],
          color: "bg-rose-500",
        },
        {
          key: "historical",
          label: "Sin detalle",
          amount: unclassifiedHistorical,
          color: "bg-stone-400",
        },
      ].filter((item) => item.amount > 0)
    : [];
  return (
    <div
      ref={infoRef}
      className="relative rounded-2xl border border-stone-200 bg-white p-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CategoryIcon category={category} />
          <p className="text-sm font-medium text-stone-900">{meta.label}</p>
        </div>
        <div className="flex items-center gap-1">
          <p className="text-xs text-stone-400">
            {isMixedSplit
              ? "Reparto inicial (mixto)"
              : capWasAdjusted
                ? `${pct}% inicial`
                : `${pct}%`}
          </p>
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
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-stone-200">
            <div
              className={`h-full rounded-full ${status.overCap ? "bg-red-500" : meta.bar}`}
              style={{ width: `${status.barWidth}%` }}
            />
          </div>

          <p
            className={`mt-3 text-center text-2xl font-semibold ${
              month.closed
                ? displayBalance.isOverCapAtClose
                  ? "text-red-600"
                  : "text-teal-700"
                : status.isLow
                  ? "text-red-600"
                  : "text-teal-700"
            }`}
          >
            {formatCents(displayBalance.amountCents)}
          </p>
          <p className="text-center text-sm font-normal text-stone-400">
            {displayBalance.label}
          </p>
          {month.closed && displayBalance.netDeficitCents > 0 && (
            <p className="mt-1 text-center text-xs font-medium text-amber-700">
              Déficit neto del mes: {formatCents(displayBalance.netDeficitCents)}
            </p>
          )}
          {!month.closed && carriedDeficit > 0 && (
            <p className="mt-1 text-center text-xs font-medium text-amber-700">
              Incluye déficit arrastrado del mes anterior:{" "}
              {formatCents(carriedDeficit)}
            </p>
          )}

          {showCategoryFormula && (
            <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">
              Del reparto de ingresos: {formatCents(realInitialCap ?? 0)} +
              Heredado del mes anterior:{" "}
              {formatCents(resolvedInheritedCents)}{" "}
              {categoryMovementsDelta >= 0 ? "+" : "−"} Movimientos:{" "}
              {formatCents(Math.abs(categoryMovementsDelta))} = Tope propio:{" "}
              <span className="font-medium text-stone-900">
                {formatCents(ownedCap)}
              </span>
            </div>
          )}

          <div
            className={`mt-3 grid gap-3 rounded-xl bg-stone-50 p-3 text-xs ${
              capWasAdjusted || isMixedSplit || !initialSplitDeterminable
                ? "grid-cols-2"
                : "grid-cols-1"
            }`}
          >
            <div>
              <p className="text-stone-400">Gastado</p>
              <p className="mt-0.5 font-medium text-stone-900">
                {formatCents(ownedSpent)}
              </p>
              <p className="text-stone-400">de {formatCents(ownedCap)}</p>
            </div>

            {(capWasAdjusted || isMixedSplit || !initialSplitDeterminable) && (
              <div>
                <p className="text-stone-400">Actual</p>
                <p className="mt-0.5 font-medium text-stone-900">
                  {actualPct}%
                </p>
                <p className="text-stone-400">
                  {isMixedSplit ? "Reparto inicial (mixto):" : "Inicial:"}{" "}
                  {initialSplitDeterminable
                    ? isMixedSplit
                      ? formatCents(realInitialCap ?? 0)
                      : `${formatCents(realInitialCap ?? 0)} (${pct}%)`
                    : "No determinable"}
                </p>
              </div>
            )}
          </div>

          {outflowSyncing && (
            <p
              role="status"
              aria-live="polite"
              className="mt-3 px-1 text-xs text-stone-400"
            >
              Actualizando desglose…
            </p>
          )}

          {sourceItems.length > 0 && (
            <div className="mt-3 px-1">
              <p className="text-xs font-medium text-stone-500">
                Origen del gasto
              </p>
              <div
                className={`mt-2 grid gap-x-3 gap-y-2 ${
                  sourceItems.length >= 3
                    ? "grid-cols-3"
                    : sourceItems.length === 2
                      ? "grid-cols-2"
                      : "grid-cols-1"
                }`}
              >
                {sourceItems.map((item) => (
                  <div key={item.key} className="min-w-0 text-xs">
                    <p className="flex items-center gap-1.5 text-stone-500">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${item.color}`} />
                      <span>{item.label}</span>
                    </p>
                    <p className="mt-0.5 pl-3.5 font-medium text-stone-900">
                      {formatCents(item.amount)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* El botón solo se oculta cuando el panel real está abierto: si
              apareció el aviso de "sin excedente", sigue a la vista. */}
          {isCurrentMonth && !(showMove && hasSurplus) && (
            <button
              type="button"
              onClick={() => setShowMove(true)}
              className="mt-2 text-xs font-medium text-teal-600"
            >
              Mover excedente →
            </button>
          )}

          {showMove &&
            (hasSurplus ? (
              <MoveSurplusPanel
                userId={userId}
                monthId={monthId}
                origin={category}
                disponibleCents={movableSurplus}
                destinations={destinations}
                capsCents={month.capsCents}
                savingsTotalCents={savingsTotalCents}
                essentialNeedsTotalCents={essentialNeedsTotalCents}
                onClose={() => setShowMove(false)}
              />
            ) : (
              <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
                <p className="text-xs text-amber-800">
                  No te queda excedente propio en {meta.label} este mes. Los
                  fondos prestados no son excedente: se usan directamente al
                  registrar un egreso en Necesidad u Ocio.
                </p>
                <button
                  type="button"
                  onClick={() => setShowMove(false)}
                  className="mt-2 w-full rounded-lg border border-amber-400 bg-white py-1.5 text-xs font-medium text-amber-800"
                >
                  Entendido
                </button>
              </div>
            ))}
        </>
      )}

      {showInfo && (
        <div className="absolute right-4 top-10 z-10 w-56 rounded-xl bg-stone-900 px-3 py-2 text-xs text-white shadow-lg">
          {!initialSplitDeterminable
            ? `Tu tope propio actual es ${formatCents(ownedCap)}. No pudimos determinar si corresponde exactamente a tu ${pct}% inicial de este mes (datos incompletos).`
            : capWasAdjusted || inheritedCategoryCents > 0
              ? `Tu disponible propio parte de un tope de ${formatCents(ownedCap)}. No es solo tu ${pct}% inicial: incluye sobrante heredado del mes anterior, ingresos recibidos con otro % o movimientos entre categorías.`
              : `Tu tope propio es ${formatCents(ownedCap)}, según tu ${pct}% inicial. Los fondos de préstamos se muestran por separado.`}
        </div>
      )}
    </div>
  );
}

function LoanSummaryCard({ userId }: { userId: string }) {
  const [loans, setLoans] = useState<LoanWithId[]>([]);

  useEffect(
    () =>
      watchLoans(userId, setLoans, (error) => {
        console.error("watchLoans falló:", error);
      }),
    [userId],
  );

  const today = toDateInputValue();
  const active = loans.filter((loan) => getLoanOutstandingCents(loan) > 0);
  const outstanding = active.reduce(
    (sum, loan) => sum + getLoanOutstandingCents(loan),
    0,
  );
  const availableFunds = loans.reduce(
    (sum, loan) => sum + Math.max(0, loan.borrowedAvailableCents),
    0,
  );
  const pending = active
    .map((loan) => ({ loan, installment: getNextPendingInstallment(loan) }))
    .filter(
      (item): item is { loan: LoanWithId; installment: NonNullable<typeof item.installment> } =>
        item.installment !== null,
    )
    .sort((a, b) => a.installment.dueDate.localeCompare(b.installment.dueDate));
  const next = pending[0] ?? null;
  const overdue = active.reduce(
    (sum, loan) =>
      sum +
      loan.installments.filter(
        (item) => getLoanInstallmentStatus(item, today) === "overdue",
      ).length,
    0,
  );

  return (
    <Link
      to="/loans"
      className="block p-4"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-600">
          <MaskIcon src={loanIcon} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-stone-900">Préstamos</p>
          {loans.length === 0 ? (
            <p className="mt-1 text-xs text-stone-400">Sin préstamos registrados</p>
          ) : (
            <>
              <p className="mt-1 text-xs text-stone-500">
                <span className="font-medium text-violet-700">
                  {formatCents(availableFunds)}
                </span>{" "}
                disponible · {formatCents(outstanding)} de deuda
              </p>
              <p className={overdue > 0 ? "mt-1 text-xs text-red-600" : "mt-1 text-xs text-stone-400"}>
                {overdue > 0
                  ? `${overdue} ${overdue === 1 ? "cuota vencida" : "cuotas vencidas"}`
                  : next
                    ? `Próxima: ${formatDateLabel(next.installment.dueDate)}`
                    : "Sin cuotas pendientes"}
              </p>
            </>
          )}
        </div>
        <span className="text-xs font-medium text-violet-600">Ver →</span>
      </div>
    </Link>
  );
}

function CreditCardSummaryCard({ userId }: { userId: string }) {
  const [cards, setCards] = useState<CreditCardWithId[]>([]);

  useEffect(
    () =>
      watchCreditCards(userId, setCards, (error) => {
        console.error("watchCreditCards falló:", error);
      }),
    [userId],
  );

  const today = toDateInputValue();
  const totalDebt = cards.reduce((sum, card) => sum + card.currentDebtCents, 0);
  const totalAvailable = cards.reduce(
    (sum, card) => sum + Math.max(0, getAvailableCreditCents(card)),
    0,
  );
  const activeStatements = cards
    .filter((card) => card.activeStatement)
    .map((card) => ({ card, statement: card.activeStatement! }));
  const overdueCount = activeStatements.filter(
    ({ statement }) =>
      getCreditCardStatementStatus(statement, today) === "overdue",
  ).length;
  const nextStatement = activeStatements
    .filter(
      ({ statement }) =>
        getCreditCardStatementStatus(statement, today) !== "paid",
    )
    .sort((a, b) => a.statement.dueDate.localeCompare(b.statement.dueDate))[0];

  return (
    <Link
      to="/credit-cards"
      className="block border-t border-stone-200 p-4"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600">
          <MaskIcon src={creditCardIcon} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-stone-900">
            Tarjetas de crédito
          </p>
          {cards.length === 0 ? (
            <p className="mt-1 text-xs text-stone-400">Sin tarjetas registradas</p>
          ) : (
            <>
              <p className="mt-1 text-xs text-stone-500">
                <span className="font-medium text-sky-700">
                  {formatCents(totalAvailable)}
                </span>{" "}
                de línea · {formatCents(totalDebt)} de deuda
              </p>
              <p
                className={`mt-1 text-xs ${
                  overdueCount > 0 ? "text-red-600" : "text-stone-400"
                }`}
              >
                {overdueCount > 0
                  ? `${overdueCount} ${overdueCount === 1 ? "pago mínimo vencido" : "pagos mínimos vencidos"}`
                  : nextStatement
                    ? `Próximo vencimiento: ${formatDateLabel(nextStatement.statement.dueDate)}`
                    : "Sin estados de cuenta pendientes"}
              </p>
            </>
          )}
        </div>
        <span className="text-xs font-medium text-sky-600">Ver →</span>
      </div>
    </Link>
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
  essentialNeedsTotalCents,
  onClose,
}: {
  userId: string;
  monthId: string;
  origin: CategoryKey;
  disponibleCents: number;
  destinations: CategoryKey[];
  capsCents: MonthCaps;
  savingsTotalCents: number;
  essentialNeedsTotalCents: number;
  onClose: () => void;
}) {
  const [amountInput, setAmountInput] = useState("");
  const [destination, setDestination] = useState<CategoryKey>(destinations[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acknowledgedWarningFor, setAcknowledgedWarningFor] = useState<
    string | null
  >(null);

  const parsedAmount = parseFloat(amountInput);
  const amountCents =
    Number.isFinite(parsedAmount) && parsedAmount > 0
      ? Math.round(parsedAmount * 100)
      : 0;
  const exceedsAvailable = amountCents > disponibleCents;

  // Sacar excedente de Necesidad podría dejar menos que lo que aún falta
  // cubrir de tus necesidades esenciales declaradas este mes. Se compara
  // contra lo PENDIENTE (declarado menos ya gastado en Necesidad), no
  // contra el total - si ya cubriste tus necesidades con lo gastado, no
  // debería seguir avisando. Aviso, no bloqueo: el excedente es tuyo.
  const remainingDisponibleCents = disponibleCents - amountCents;
  const spentNecesidadCents =
    origin === "necesidad" ? capsCents.necesidad - disponibleCents : 0;
  const needsStillPendingCents = Math.max(
    0,
    essentialNeedsTotalCents - spentNecesidadCents,
  );
  const needsWarning =
    origin === "necesidad" &&
    needsStillPendingCents > 0 &&
    amountCents > 0 &&
    !exceedsAvailable &&
    remainingDisponibleCents < needsStillPendingCents;
  const warningKey = `${amountCents}:${destination}`;
  const warningAcknowledged = acknowledgedWarningFor === warningKey;

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
    if (needsWarning && !warningAcknowledged) {
      setError('Marca "Continuar de todas formas" para confirmar');
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
      <p className="text-sm font-medium text-teal-700">
        {origin === "ahorro" ? "Usar ahorro" : "Mover excedente"}
      </p>

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

      {needsWarning && (
        <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2">
          <p className="text-xs text-amber-800">
            Aún te faltan {formatCents(needsStillPendingCents)} por cubrir de
            tus necesidades esenciales este mes. Con este movimiento te
            quedaría {formatCents(remainingDisponibleCents)} disponible en
            Necesidad - podría no alcanzarte.
          </p>
          <label className="mt-1.5 flex items-center gap-2 text-xs text-amber-800">
            <input
              type="checkbox"
              checked={warningAcknowledged}
              onChange={(e) =>
                setAcknowledgedWarningFor(e.target.checked ? warningKey : null)
              }
            />
            Continuar de todas formas
          </label>
        </div>
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
          disabled={
            saving ||
            amountCents <= 0 ||
            exceedsAvailable ||
            (needsWarning && !warningAcknowledged)
          }
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
  accumulatedCents,
  unassignedCents,
  assignableCents,
  contributedThisMonth,
  monthlyNetCents,
  percentage,
  initialSplitAhorroCents,
  isInitialSplitDeterminable,
  isMixedSplit,
  netContributionCents,
  ahorroActualPct,
  isAhorroActualDeterminable,
  envelopeDeficitWarning,
}: {
  userId: string;
  monthId: string;
  isCurrentMonth: boolean;
  capsCents: MonthCaps;
  savingsTotalCents: number;
  accumulatedCents: number | null;
  unassignedCents: number | null;
  assignableCents: number;
  contributedThisMonth: number;
  monthlyNetCents: number | null;
  percentage: number;
  initialSplitAhorroCents: number;
  isInitialSplitDeterminable: boolean;
  isMixedSplit: boolean;
  netContributionCents: number;
  ahorroActualPct: string | null;
  isAhorroActualDeterminable: boolean;
  envelopeDeficitWarning: string | null;
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

  // La opción se muestra siempre en el mes actual: si no hay plata libre, se
  // explica al pulsarla en vez de desaparecer sin motivo aparente.
  const hasAssignable = assignableCents > 0;

  return (
    <div
      ref={infoRef}
      className="relative rounded-2xl border border-stone-200 bg-white p-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CategoryIcon category="ahorro" />
          <p className="text-sm font-medium text-stone-900">{meta.label}</p>
        </div>
        <div className="flex items-center gap-1">
          <p className="text-xs text-stone-400">{formatMonthLabel(monthId)}</p>
          <button
            type="button"
            onClick={() => setShowInfo((v) => !v)}
            aria-label="Qué es el ahorro neto mensual"
            className="flex h-4 w-4 items-center justify-center rounded-full bg-stone-200 text-[10px] text-stone-500"
          >
            ?
          </button>
        </div>
      </div>

      <p className={`mt-3 text-center text-2xl font-semibold ${monthlyNetCents !== null && monthlyNetCents < 0 ? "text-red-600" : "text-teal-700"}`}>
        {monthlyNetCents === null ? "No determinable" : formatCents(monthlyNetCents)}
      </p>
      <p className="text-center text-xs text-stone-500">Ahorro neto del mes</p>

      {envelopeDeficitWarning && (
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
          {envelopeDeficitWarning}
        </div>
      )}

      <div className="mt-3 grid grid-cols-3 gap-3 rounded-xl bg-stone-50 p-3 text-xs">
        <div>
          <p className="text-stone-400">
            {isMixedSplit ? "Reparto inicial (mixto)" : "Reparto inicial"}
          </p>
          <p className="mt-0.5 font-medium text-stone-900">
            {!isInitialSplitDeterminable
              ? "No determinable"
              : isMixedSplit
                ? formatCents(initialSplitAhorroCents)
                : `${percentage}%`}
          </p>
        </div>
        <div>
          <p className="text-stone-400">Aportado este mes</p>
          <p className="mt-0.5 font-medium text-stone-900">
            +{formatCents(contributedThisMonth)}
          </p>
        </div>
        <div>
          <p className="text-stone-400">Actual</p>
          <p className="mt-0.5 font-medium text-stone-900">
            {!isAhorroActualDeterminable
              ? "No determinable"
              : netContributionCents < 0
                ? "Aporte neto negativo"
                : ahorroActualPct !== null
                  ? `${ahorroActualPct}%`
                  : "—"}
          </p>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-stone-200 p-3">
        <p className="text-xs text-stone-500">Ahorro acumulado total · a hoy</p>
        <p className="mt-1 text-lg font-semibold text-teal-700">
          {accumulatedCents === null ? "No determinable" : formatCents(accumulatedCents)}
        </p>
        <p className="mt-1 text-xs text-stone-400">
          {unassignedCents === null
            ? "Sin asignar a metas: No determinable"
            : unassignedCents < 0
              ? `Sobreasignado: ${formatCents(-unassignedCents)} por liberar`
              : `Sin asignar a metas: ${formatCents(unassignedCents)}`}
        </p>
      </div>
      {/* Las acciones utilizan el acumulado disponible, no el flujo mensual. */}
      <div className="mt-2 flex flex-col items-start gap-2 text-xs font-medium text-teal-600">
        {isCurrentMonth && !(showMove && hasAssignable) && (
          <button type="button" onClick={() => setShowMove(true)}>
            Usar ahorro →
          </button>
        )}
        <Link to="/goals">Metas →</Link>
        <Link to="/movements">Ver detalle →</Link>
      </div>

      {showMove &&
        (hasAssignable ? (
          <MoveSurplusPanel
            userId={userId}
            monthId={monthId}
            origin="ahorro"
            disponibleCents={assignableCents}
            destinations={["necesidad", "ocio"]}
            capsCents={capsCents}
            savingsTotalCents={savingsTotalCents}
            essentialNeedsTotalCents={0}
            onClose={() => setShowMove(false)}
          />
        ) : (
          <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
            <p className="text-xs text-amber-800">
              Todo tu ahorro está asignado a metas. Para mover dinero, primero
              libera una parte desde Metas.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setShowMove(false)}
                className="flex-1 rounded-lg border border-amber-400 bg-white py-1.5 text-xs font-medium text-amber-800"
              >
                Entendido
              </button>
              <Link
                to="/goals"
                className="flex-1 rounded-lg bg-amber-600 py-1.5 text-center text-xs font-medium text-white"
              >
                Ir a Metas
              </Link>
            </div>
          </div>
        ))}

      {showInfo && (
        <div className="absolute bottom-full left-4 mb-2 w-56 rounded-xl bg-stone-900 px-3 py-2 text-xs text-white shadow-lg">
          El neto suma lo aportado este mes y resta compras, retiros, pagos
          desde Ahorro y transferencias a otras categorías. En meses cerrados
          incluye el excedente de Ocio del cierre. Puede ser negativo si usaste
          ahorro anterior. El acumulado total conserva el dinero de todos los meses.
        </div>
      )}
    </div>
  );
}

function MovementsModal({
  movements,
  onClose,
}: {
  movements: MovementWithId[];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-5 pb-5 sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-stone-900">
            Movimientos de excedentes
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-6 w-6 items-center justify-center rounded-full bg-stone-100 text-stone-500"
          >
            ✕
          </button>
        </div>

        <div className="mt-3 flex flex-col gap-3">
          {movements.length === 0 ? (
            <p className="py-4 text-center text-sm text-stone-400">
              No hay movimientos registrados este mes
            </p>
          ) : (
            movements.map((m) => <MovementRow key={m._id} movement={m} />)
          )}
        </div>
      </div>
    </div>
  );
}

function PendingCloseGraceBanner({
  userId,
  pendingMonthId,
  unassignedSavingsCents,
}: {
  userId: string;
  pendingMonthId: string;
  unassignedSavingsCents: number;
}) {
  const navigate = useNavigate();
  const [pendingMonth, setPendingMonth] = useState<Month | null>(null);
  const [showDeficitModal, setShowDeficitModal] = useState(false);
  const [selectedDecision, setSelectedDecision] =
    useState<DeficitResolution>("covered_by_savings");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ref = doc(db, "users", userId, "months", pendingMonthId);
    return onSnapshot(
      ref,
      (snap) => {
        setPendingMonth(snap.exists() ? (snap.data() as Month) : null);
      },
      (err) => {
        console.error("Error al observar mes pendiente de cierre:", err);
      },
    );
  }, [userId, pendingMonthId]);

  if (!pendingMonth || pendingMonth.closed) return null;

  const remainders = getMonthRemainders(pendingMonth);
  const netDeficitCents = remainders.netDeficitCents;
  const maxCoverableCents = Math.max(
    0,
    Math.min(netDeficitCents, unassignedSavingsCents),
  );
  const remainingUncoveredCents = netDeficitCents - maxCoverableCents;
  const deadlineDate = getGraceDeadlineDate(pendingMonthId);

  async function handleConfirmClose(decision: DeficitResolution) {
    setSubmitting(true);
    setError(null);
    try {
      await confirmMonthClose(userId, pendingMonthId, decision);
      setShowDeficitModal(false);
    } catch (err) {
      console.error("Error al confirmar cierre de mes:", err);
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo confirmar el cierre. Intenta de nuevo.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <section
        className="mx-5 mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4"
        aria-label="Mes anterior en ventana de gracia"
      >
        <p className="text-sm font-medium text-amber-900">
          Tu mes de {formatMonthLongLabel(pendingMonthId)} sigue abierto hasta
          el {formatDateLabel(deadlineDate)}. Registra gastos olvidados y
          confirma el cierre
        </p>
        {netDeficitCents > 0 && (
          <p className="mt-1 text-xs text-amber-800">
            Déficit neto detectado en {formatMonthLabel(pendingMonthId)}:{" "}
            {formatCents(netDeficitCents)}
          </p>
        )}
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={submitting}
            onClick={() => {
              if (netDeficitCents > 0) {
                setSelectedDecision(
                  maxCoverableCents > 0
                    ? "covered_by_savings"
                    : "carried_forward",
                );
                setShowDeficitModal(true);
              } else {
                void handleConfirmClose("none");
              }
            }}
            className="rounded-xl bg-amber-700 px-3.5 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            {submitting ? "Cerrando..." : "Confirmar cierre"}
          </button>
          <Link
            to="/history"
            className="rounded-xl border border-amber-400 bg-white px-3 py-2 text-xs font-medium text-amber-800"
          >
            Revisar movimientos
          </Link>
        </div>
      </section>

      {showDeficitModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-5 pb-5 sm:items-center"
          onClick={() => !submitting && setShowDeficitModal(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-stone-900">
              Resolver déficit antes de cerrar {formatMonthLabel(pendingMonthId)}
            </h3>
            <p className="mt-1 text-xs text-stone-600">
              Tu mes de {formatMonthLabel(pendingMonthId)} cerró con un déficit
              neto de{" "}
              <span className="font-semibold text-amber-700">
                {formatCents(netDeficitCents)}
              </span>
              . Elige cómo quieres tratarlo:
            </p>

            <div className="mt-4 flex flex-col gap-2.5">
              <label
                className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-xs ${
                  selectedDecision === "covered_by_savings"
                    ? "border-teal-600 bg-teal-50/60"
                    : "border-stone-200 bg-white"
                }`}
              >
                <input
                  type="radio"
                  name="deficit-resolution"
                  checked={selectedDecision === "covered_by_savings"}
                  onChange={() => setSelectedDecision("covered_by_savings")}
                  className="mt-0.5"
                />
                <div>
                  <p className="font-medium text-stone-900">
                    1) Cubrir con ahorro sin asignar (hasta{" "}
                    {formatCents(maxCoverableCents)})
                  </p>
                  <p className="mt-0.5 text-stone-500">
                    Disponible sin asignar a metas:{" "}
                    {formatCents(Math.max(0, unassignedSavingsCents))}.
                    {remainingUncoveredCents > 0
                      ? ` Se cubrirán ${formatCents(maxCoverableCents)} y quedarán ${formatCents(remainingUncoveredCents)} registrados como déficit pendiente.`
                      : ` Se descontarán ${formatCents(maxCoverableCents)} de tu ahorro sin asignar.`}
                  </p>
                </div>
              </label>

              <label
                className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-xs ${
                  selectedDecision === "carried_forward"
                    ? "border-teal-600 bg-teal-50/60"
                    : "border-stone-200 bg-white"
                }`}
              >
                <input
                  type="radio"
                  name="deficit-resolution"
                  checked={selectedDecision === "carried_forward"}
                  onChange={() => setSelectedDecision("carried_forward")}
                  className="mt-0.5"
                />
                <div>
                  <p className="font-medium text-stone-900">
                    2) Arrastrar el déficit al mes nuevo (
                    {formatCents(netDeficitCents)})
                  </p>
                  <p className="mt-0.5 text-stone-500">
                    Reduce el disponible de Necesidad del mes actual en{" "}
                    {formatCents(netDeficitCents)} sin tocar tu ahorro.
                  </p>
                </div>
              </label>

              <button
                type="button"
                onClick={() => {
                  setShowDeficitModal(false);
                  navigate("/history");
                }}
                className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-left text-xs font-medium text-stone-800"
              >
                3) Revisar o editar gastos en Historial antes de cerrar →
              </button>
            </div>

            {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setShowDeficitModal(false)}
                className="flex-1 rounded-xl border border-stone-300 py-2.5 text-xs font-medium text-stone-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleConfirmClose(selectedDecision)}
                className="flex-1 rounded-xl bg-stone-900 py-2.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {submitting ? "Confirmando..." : "Confirmar cierre"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
