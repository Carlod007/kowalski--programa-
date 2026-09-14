import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/store/authStore";
import { checkAndCloseMonth, moveSurplus } from "@/services/monthService";
import { getMonthInitialSplit } from "@/services/movementService";
import { watchLoans } from "@/services/loanService";
import { watchCreditCards } from "@/services/creditCardService";
import { getMonthExpenses } from "@/services/analyticsService";
import { useAhorroBreakdown } from "@/hooks/useAhorroBreakdown";
import { getAssignableCents } from "@/utils/savings";
import { getMonthId, shiftMonthId, formatMonthLabel } from "@/utils/date";
import { formatCents } from "@/utils/currency";
import {
  CAP_CATEGORY_ORDER,
  CATEGORY_META,
  getCategoryStatus,
} from "@/utils/category";
import type { Month, MonthCaps } from "@/types/month";
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

      <MonthSummary
        key={viewedMonthId}
        userId={user.uid}
        monthId={viewedMonthId}
        canGoForward={canGoForward}
        isCurrentMonth={isViewingCurrentMonth}
        savingsTotalCents={userProfile?.savingsTotalCents ?? 0}
        assignableCents={assignableCents}
        essentialNeedsTotalCents={essentialNeedsTotalCents}
        onPrev={() => setViewedMonthId((id) => shiftMonthId(id, -1))}
        onNext={() => setViewedMonthId((id) => shiftMonthId(id, 1))}
      />

      {isViewingCurrentMonth && <LoanSummaryCard userId={user.uid} />}
      {isViewingCurrentMonth && <CreditCardSummaryCard userId={user.uid} />}

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
  assignableCents,
  essentialNeedsTotalCents,
  onPrev,
  onNext,
}: {
  userId: string;
  monthId: string;
  canGoForward: boolean;
  isCurrentMonth: boolean;
  savingsTotalCents: number;
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
    let latestExpenses: ExpenseTransaction[] | undefined;
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
        latestExpenses = [];
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
    netContributionCents,
    ahorroActualPct,
    isAhorroActualDeterminable,
  } = useAhorroBreakdown(
    userId,
    monthId,
    month?.ahorroContributedCents ?? 0,
    month?.totalIncomeCents ?? 0,
    month?.directSavingsCents ?? 0,
  );

  return (
    <>
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
              assignableCents={assignableCents}
              contributedThisMonth={month.ahorroContributedCents}
              percentage={month.distribution.ahorro}
              netContributionCents={netContributionCents}
              ahorroActualPct={ahorroActualPct}
              isAhorroActualDeterminable={isAhorroActualDeterminable}
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
  expenses: ExpenseTransaction[] | null;
  outflowSyncing: boolean;
}) {
  const meta = CATEGORY_META[category];
  const cap = month.capsCents[category];
  const spent = month.spentCents[category];
  const borrowedCap = month.borrowedCapsCents?.[category] ?? 0;
  const loanFundedSpent = month.loanFundedSpentCents?.[category] ?? 0;
  const borrowedAvailable = Math.max(0, borrowedCap - loanFundedSpent);
  const ownedCap = cap - borrowedCap;
  const ownedSpent = spent - loanFundedSpent;
  const movableSurplus = ownedCap - ownedSpent;
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
            {capWasAdjusted ? `${pct}% inicial` : `${pct}%`}
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
              status.isLow ? "text-red-600" : "text-teal-700"
            }`}
          >
            {formatCents(status.disponible)}
          </p>
          <p className="text-center text-sm font-normal text-stone-400">
            disponible
          </p>

          <div
            className={`mt-3 grid gap-3 rounded-xl bg-stone-50 p-3 text-xs ${
              capWasAdjusted || !initialSplitDeterminable
                ? "grid-cols-2"
                : "grid-cols-1"
            }`}
          >
            <div>
              <p className="text-stone-400">Gastado</p>
              <p className="mt-0.5 font-medium text-stone-900">
                {formatCents(spent)}
              </p>
              <p className="text-stone-400">de {formatCents(cap)}</p>
            </div>

            {(capWasAdjusted || !initialSplitDeterminable) && (
              <div>
                <p className="text-stone-400">Actual</p>
                <p className="mt-0.5 font-medium text-stone-900">
                  {actualPct}%
                </p>
                <p className="text-stone-400">
                  Inicial:{" "}
                  {initialSplitDeterminable
                    ? `${formatCents(realInitialCap ?? 0)} (${pct}%)`
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

          {borrowedAvailable > 0 && (
            <p className="mt-2 px-1 text-xs font-medium text-violet-600">
              Prestado disponible: {formatCents(borrowedAvailable)}
            </p>
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
                  fondos prestados no se pueden mover entre categorías.
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
            ? `Tu tope actual es ${formatCents(cap)}. No pudimos determinar si corresponde exactamente a tu ${pct}% inicial de este mes (datos incompletos).`
            : capWasAdjusted
            ? `Tu disponible propio parte de un tope de ${formatCents(ownedCap)}. No es solo tu ${pct}% inicial: incluye ingresos recibidos con otro % o movimientos entre categorías.`
            : `Tu tope propio es ${formatCents(ownedCap)}, según tu ${pct}% inicial.${borrowedCap > 0 ? ` Además, este mes entraron ${formatCents(borrowedCap)} de préstamos.` : ""}`}
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
      className="mx-5 mt-4 block rounded-2xl border border-violet-200 bg-white p-4"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-stone-900">Préstamos</p>
        <span className="text-xs font-medium text-violet-600">Ver →</span>
      </div>
      {active.length === 0 ? (
        <p className="mt-2 text-sm text-stone-400">Sin deuda pendiente</p>
      ) : (
        <div className="mt-2 flex items-end justify-between gap-3">
          <div>
            <p className="text-xl font-semibold text-violet-700">
              {formatCents(outstanding)}
            </p>
            <p className="text-xs text-stone-400">deuda pendiente</p>
          </div>
          <p className={overdue > 0 ? "text-xs text-red-600" : "text-xs text-stone-500"}>
            {overdue > 0
              ? `${overdue} ${overdue === 1 ? "cuota vencida" : "cuotas vencidas"}`
              : next
                ? `Próxima: ${formatDateLabel(next.installment.dueDate)}`
                : "Sin cuotas pendientes"}
          </p>
        </div>
      )}
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
      className="mx-5 mt-4 block rounded-2xl border border-sky-200 bg-white p-4"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-stone-900">
          Tarjetas de crédito
        </p>
        <span className="text-xs font-medium text-sky-600">Ver →</span>
      </div>
      {cards.length === 0 ? (
        <p className="mt-2 text-sm text-stone-400">Sin tarjetas registradas</p>
      ) : (
        <div className="mt-2 grid grid-cols-2 gap-3">
          <div>
            <p className="text-lg font-semibold text-sky-700">
              {formatCents(totalDebt)}
            </p>
            <p className="text-xs text-stone-400">deuda actual</p>
          </div>
          <div>
            <p className="text-lg font-semibold text-stone-800">
              {formatCents(totalAvailable)}
            </p>
            <p className="text-xs text-stone-400">línea disponible</p>
          </div>
          <p
            className={`col-span-2 text-xs ${
              overdueCount > 0 ? "text-red-600" : "text-stone-500"
            }`}
          >
            {overdueCount > 0
              ? `${overdueCount} ${overdueCount === 1 ? "pago mínimo vencido" : "pagos mínimos vencidos"}`
              : nextStatement
                ? `Próximo vencimiento: ${formatDateLabel(nextStatement.statement.dueDate)}`
                : "Sin estados de cuenta pendientes"}
          </p>
        </div>
      )}
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
  assignableCents,
  contributedThisMonth,
  percentage,
  netContributionCents,
  ahorroActualPct,
  isAhorroActualDeterminable,
}: {
  userId: string;
  monthId: string;
  isCurrentMonth: boolean;
  capsCents: MonthCaps;
  savingsTotalCents: number;
  assignableCents: number;
  contributedThisMonth: number;
  percentage: number;
  netContributionCents: number;
  ahorroActualPct: string | null;
  isAhorroActualDeterminable: boolean;
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

      <p className="mt-3 text-center text-2xl font-semibold text-teal-700">
        {formatCents(savingsTotalCents)}
      </p>

      <div className="mt-3 grid grid-cols-3 gap-3 rounded-xl bg-stone-50 p-3 text-xs">
        <div>
          <p className="text-stone-400">Reparto inicial</p>
          <p className="mt-0.5 font-medium text-stone-900">{percentage}%</p>
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

      {/* El botón solo se oculta cuando el panel real está abierto: si
          apareció el aviso de "sin plata libre", sigue a la vista. */}
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
          El acumulado nunca se resetea - cada mes se suma más, y solo baja
          cuando compras una meta. "Aportado este mes" es lo que entró este
          mes (reparto inicial + lo que hayas movido aquí), no tu crecimiento
          neto: si sacaste dinero de Ahorro, no se resta de ahí.
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
