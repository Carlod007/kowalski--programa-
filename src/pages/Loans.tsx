import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  ChevronDown,
  Plus,
  Trash2,
} from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { checkAndCloseMonth } from "@/services/monthService";
import {
  cancelUnusedLoan,
  createLoan,
  reassignLoanFunds,
  recordLoanPayment,
  watchLoanFundMovements,
  watchLoans,
} from "@/services/loanService";
import {
  addMonthsToDate,
  allocateLoanPayment,
  getBorrowedAvailableByCategory,
  getLoanInstallmentStatus,
  getLoanOutstandingCents,
  getNextPendingInstallment,
} from "@/utils/loans";
import { formatCents } from "@/utils/currency";
import {
  formatDateLabel,
  formatMonthLabel,
  getMonthId,
  toDateInputValue,
} from "@/utils/date";
import { CATEGORY_META } from "@/utils/category";
import type {
  LoanDestinationCategory,
  LoanFundMovementWithId,
  LoanPaymentSource,
  LoanScheduleType,
  LoanWithId,
} from "@/types/loan";
import BackButton from "@/components/BackButton";

export default function Loans() {
  const user = useAuthStore((state) => state.user);
  const userProfile = useAuthStore((state) => state.userProfile);
  const [loans, setLoans] = useState<LoanWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    if (!user) return;
    checkAndCloseMonth(user.uid).catch((error) => {
      console.error("checkAndCloseMonth falló:", error);
    });
    return watchLoans(
      user.uid,
      (items) => {
        setLoans(items);
        setLoading(false);
      },
      (error) => {
        console.error("watchLoans falló:", error);
        setLoadError("No se pudieron cargar los préstamos.");
        setLoading(false);
      },
    );
  }, [user]);

  if (!user || !userProfile) return null;

  const outstandingCents = loans.reduce(
    (sum, loan) => sum + getLoanOutstandingCents(loan),
    0,
  );
  const today = toDateInputValue();
  const overdueCount = loans.reduce(
    (sum, loan) =>
      sum +
      loan.installments.filter(
        (item) => getLoanInstallmentStatus(item, today) === "overdue",
      ).length,
    0,
  );
  const fixedIncomeCents = (userProfile.fixedIncomes ?? []).reduce(
    (sum, income) => sum + income.monthlyAmountCents,
    0,
  );
  const projectedNeedCents = Math.floor(
    (fixedIncomeCents * userProfile.distribution.necesidad) / 100,
  );
  const dueByMonth = new Map<string, number>();
  for (const loan of loans) {
    for (const item of loan.installments) {
      const pending = Math.max(0, item.amountCents - item.paidCents);
      const monthId = item.dueDate.slice(0, 7);
      dueByMonth.set(monthId, (dueByMonth.get(monthId) ?? 0) + pending);
    }
  }
  const riskMonth = [...dueByMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .find(
      ([, due]) =>
        fixedIncomeCents > 0 &&
        (due > fixedIncomeCents || due > projectedNeedCents),
    );

  return (
    <div className="min-h-dvh bg-stone-50 px-5 pb-10 pt-8">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <BackButton to="/dashboard" />
          <div>
            <h1 className="text-2xl font-semibold text-stone-900">Préstamos</h1>
            <p className="text-sm text-stone-500">Solo dinero que recibiste</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((value) => !value)}
          className="rounded-xl bg-stone-900 px-3 py-2 text-sm font-medium text-white"
        >
          {showCreate ? "Cerrar" : "+ Nuevo"}
        </button>
      </header>

      <section className="mt-5 rounded-3xl bg-violet-600 p-5 text-white">
        <p className="text-sm text-violet-100">Deuda pendiente total</p>
        <p className="mt-1 text-3xl font-semibold">
          {loading ? "···" : formatCents(outstandingCents)}
        </p>
        <p className="mt-2 text-sm text-violet-100">
          {overdueCount > 0
            ? `${overdueCount} ${overdueCount === 1 ? "cuota vencida" : "cuotas vencidas"}`
            : "Sin cuotas vencidas"}
        </p>
      </section>

      {riskMonth && (
        <div className="mt-4 flex gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="text-sm">
            En {formatMonthLabel(riskMonth[0])} vencen {formatCents(riskMonth[1])}. Supera el
            monto proyectado para Necesidad según tus ingresos fijos. Es una
            alerta informativa y no bloquea pagos ni préstamos.
          </p>
        </div>
      )}

      {showCreate && (
        <NewLoanForm
          userId={user.uid}
          onDone={() => setShowCreate(false)}
        />
      )}

      {loadError && <p className="mt-4 text-sm text-red-600">{loadError}</p>}

      <main className="mt-5 flex flex-col gap-3">
        {!loading && loans.length === 0 ? (
          <p className="py-8 text-center text-sm text-stone-400">
            Todavía no registraste préstamos.
          </p>
        ) : (
          loans.map((loan) => (
            <LoanCard
              key={loan.id}
              loan={loan}
              userId={user.uid}
              paymentMethods={userProfile.paymentMethods ?? []}
            />
          ))
        )}
      </main>
    </div>
  );
}

function NewLoanForm({ userId, onDone }: { userId: string; onDone: () => void }) {
  const today = toDateInputValue();
  const [lender, setLender] = useState("");
  const [received, setReceived] = useState("");
  const [total, setTotal] = useState("");
  const [installmentAmount, setInstallmentAmount] = useState("");
  const [scheduleType, setScheduleType] =
    useState<LoanScheduleType>("fixed-known");
  const [category, setCategory] =
    useState<LoanDestinationCategory>("necesidad");
  const [count, setCount] = useState("1");
  const [firstDueDate, setFirstDueDate] = useState(today);
  const [manualInstallments, setManualInstallments] = useState(() => [
    { id: crypto.randomUUID(), dueDate: today, amount: "" },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountReceivedCents = Math.round(Number(received) * 100);
  const installmentCount = Number(count);
  const installmentAmountCents = Math.round(Number(installmentAmount) * 100);
  const enteredTotalCents = Math.round(Number(total) * 100);
  const manualValues = manualInstallments.map((item) => ({
    dueDate: item.dueDate,
    amountCents: Math.round(Number(item.amount) * 100),
  }));
  const totalToRepayCents =
    scheduleType === "fixed-known"
      ? installmentAmountCents * installmentCount
      : scheduleType === "total-known"
        ? enteredTotalCents
        : manualValues.reduce(
            (sum, item) =>
              sum + (Number.isFinite(item.amountCents) ? item.amountCents : 0),
            0,
          );
  const loanCostCents = totalToRepayCents - amountReceivedCents;

  function updateManualInstallment(
    id: string,
    field: "dueDate" | "amount",
    value: string,
  ) {
    setManualInstallments((items) =>
      items.map((item) => (item.id === id ? { ...item, [field]: value } : item)),
    );
  }

  function addManualInstallment() {
    const lastDate = manualInstallments.at(-1)?.dueDate || today;
    setManualInstallments((items) => [
      ...items,
      {
        id: crypto.randomUUID(),
        dueDate: addMonthsToDate(lastDate, 1),
        amount: "",
      },
    ]);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!Number.isInteger(amountReceivedCents) || amountReceivedCents <= 0) {
      setError("Ingresa un monto recibido o financiado válido.");
      return;
    }
    if (scheduleType !== "custom" && !Number.isInteger(installmentCount)) {
      setError("Ingresa una cantidad de cuotas válida.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await checkAndCloseMonth(userId);
      const common = {
        lender: lender.trim() || undefined,
        amountReceivedCents,
        receivedDate: today,
        destinationCategory: category,
      };
      if (scheduleType === "fixed-known") {
        await createLoan(userId, {
          ...common,
          scheduleType,
          installmentAmountCents,
          installmentCount,
          firstDueDate,
        });
      } else if (scheduleType === "total-known") {
        await createLoan(userId, {
          ...common,
          scheduleType,
          totalToRepayCents: enteredTotalCents,
          installmentCount,
          firstDueDate,
        });
      } else {
        await createLoan(userId, {
          ...common,
          scheduleType,
          installments: manualValues,
        });
      }
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo guardar");
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-4 flex flex-col gap-3 rounded-2xl border border-violet-200 bg-white p-4"
    >
      <p className="font-medium text-stone-900">Nuevo préstamo</p>
      <label className="text-sm text-stone-600">
        Entidad / comercio / persona{" "}
        <span className="text-stone-400">(opcional)</span>
        <input
          value={lender}
          onChange={(event) => setLender(event.target.value)}
          placeholder="Yape, BCP, tienda, amigo..."
          maxLength={100}
          className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-stone-900"
        />
      </label>
      <MoneyInput
        label="Monto recibido / financiado"
        value={received}
        onChange={setReceived}
      />
      <label className="text-sm text-stone-600">
        Tipo de cronograma de pago
        <select
          value={scheduleType}
          onChange={(event) =>
            setScheduleType(event.target.value as LoanScheduleType)
          }
          className="mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-stone-900"
        >
          <option value="fixed-known">
            Cuotas fijas — monto de cuota conocido
          </option>
          <option value="total-known">
            Cuotas fijas — total a pagar conocido
          </option>
          <option value="custom">
            Cuotas variables — cronograma personalizado
          </option>
        </select>
      </label>
      <label className="text-sm text-stone-600">
        Categoría donde entra
        <select
          value={category}
          onChange={(event) =>
            setCategory(event.target.value as LoanDestinationCategory)
          }
          className="mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-stone-900"
        >
          <option value="necesidad">Necesidad</option>
          <option value="ocio">Ocio</option>
        </select>
      </label>
      {scheduleType === "fixed-known" && (
        <div className="grid grid-cols-2 gap-2">
          <MoneyInput
            label="Cuota mensual"
            value={installmentAmount}
            onChange={setInstallmentAmount}
          />
          <InstallmentCountInput value={count} onChange={setCount} />
        </div>
      )}
      {scheduleType === "total-known" && (
        <div className="grid grid-cols-2 gap-2">
          <MoneyInput label="Total a devolver" value={total} onChange={setTotal} />
          <InstallmentCountInput value={count} onChange={setCount} />
        </div>
      )}
      {scheduleType !== "custom" && (
        <label className="text-sm text-stone-600">
          Primer vencimiento
          <input
            value={firstDueDate}
            onChange={(event) => setFirstDueDate(event.target.value)}
            type="date"
            min={today}
            className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-stone-900"
          />
        </label>
      )}
      {scheduleType === "custom" && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-stone-700">Calendario manual</p>
          {manualInstallments.map((item, index) => (
            <div
              key={item.id}
              className="grid grid-cols-[1fr_1fr_auto] items-end gap-2"
            >
              <label className="text-xs text-stone-600">
                Vencimiento {index + 1}
                <input
                  value={item.dueDate}
                  onChange={(event) =>
                    updateManualInstallment(
                      item.id,
                      "dueDate",
                      event.target.value,
                    )
                  }
                  type="date"
                  min={today}
                  className="mt-1 w-full rounded-xl border border-stone-300 px-2 py-2 text-sm text-stone-900"
                />
              </label>
              <MoneyInput
                label="Monto"
                value={item.amount}
                onChange={(value) =>
                  updateManualInstallment(item.id, "amount", value)
                }
              />
              <button
                type="button"
                aria-label={`Eliminar cuota ${index + 1}`}
                disabled={manualInstallments.length === 1}
                onClick={() =>
                  setManualInstallments((items) =>
                    items.filter((candidate) => candidate.id !== item.id),
                  )
                }
                className="mb-0.5 rounded-lg border border-stone-300 p-2.5 text-stone-500 disabled:opacity-30"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addManualInstallment}
            disabled={manualInstallments.length >= 360}
            className="flex items-center justify-center gap-1 rounded-lg border border-violet-300 py-2 text-sm text-violet-700 disabled:opacity-40"
          >
            <Plus className="h-4 w-4" /> Agregar cuota
          </button>
        </div>
      )}
      {Number.isFinite(totalToRepayCents) && totalToRepayCents > 0 && (
        <div className="rounded-xl bg-stone-50 p-3 text-sm text-stone-600">
          <p>
            Total a devolver:{" "}
            <strong className="text-stone-900">
              {formatCents(totalToRepayCents)}
            </strong>
          </p>
          {amountReceivedCents > 0 && loanCostCents >= 0 && (
            <p>
              Intereses y cargos:{" "}
              <strong className="text-stone-900">
                {formatCents(loanCostCents)}
              </strong>
            </p>
          )}
        </div>
      )}
      <p className="text-xs text-stone-400">
        Fecha de recepción: {formatDateLabel(today)}. El préstamo no cuenta como
        ingreso ni altera tus porcentajes.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={saving}
        className="rounded-xl bg-violet-600 py-2.5 font-medium text-white disabled:opacity-50"
      >
        {saving ? "Guardando..." : "Confirmar préstamo"}
      </button>
    </form>
  );
}

function InstallmentCountInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-sm text-stone-600">
      Número de cuotas
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        type="number"
        min="1"
        max="360"
        step="1"
        className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-stone-900"
      />
    </label>
  );
}

function MoneyInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-sm text-stone-600">
      {label} (S/)
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        type="number"
        inputMode="decimal"
        min="0.01"
        step="0.01"
        placeholder="0.00"
        className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-stone-900"
      />
    </label>
  );
}

function LoanCard({
  loan,
  userId,
  paymentMethods,
}: {
  loan: LoanWithId;
  userId: string;
  paymentMethods: { id: string; name: string }[];
}) {
  const [showSchedule, setShowSchedule] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showReassign, setShowReassign] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const outstanding = getLoanOutstandingCents(loan);
  const next = getNextPendingInstallment(loan);
  const progress =
    loan.totalToRepayCents > 0
      ? Math.min(100, (loan.paidCents / loan.totalToRepayCents) * 100)
      : 0;
  const canCancel =
    loan.paidCents === 0 &&
    (loan.fundMovementCount ?? 0) === 0 &&
    loan.borrowedAvailableCents === loan.amountReceivedCents;
  const availableByCategory = getBorrowedAvailableByCategory(loan);

  async function handleCancelLoan() {
    setActionError(null);
    try {
      await cancelUnusedLoan(userId, loan.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "No se pudo cancelar");
      setConfirmCancel(false);
    }
  }

  return (
    <article className="rounded-2xl border border-stone-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-stone-900">
            {loan.lender?.trim() || "Préstamo"}
          </p>
          <p className="text-xs text-stone-400">
            Entrada inicial: {CATEGORY_META[loan.destinationCategory].label} · recibido {formatDateLabel(loan.receivedDate)}
          </p>
        </div>
        <span className="rounded-full bg-violet-50 px-2 py-1 text-xs font-medium text-violet-700">
          {outstanding === 0 ? "Pagado" : `${formatCents(outstanding)} pendiente`}
        </span>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-100">
        <div
          className="h-full rounded-full bg-violet-500"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <p className="text-stone-500">
          Recibido: <span className="font-medium text-stone-800">{formatCents(loan.amountReceivedCents)}</span>
        </p>
        <p className="text-stone-500">
          Intereses y cargos: <span className="font-medium text-stone-800">{formatCents(loan.totalToRepayCents - loan.amountReceivedCents)}</span>
        </p>
        <p className="text-stone-500">
          Prestado en Necesidad: <span className="font-medium text-stone-800">{formatCents(availableByCategory.necesidad)}</span>
        </p>
        <p className="text-stone-500">
          Prestado en Ocio: <span className="font-medium text-stone-800">{formatCents(availableByCategory.ocio)}</span>
        </p>
        <p className="text-stone-500">
          Próximo: <span className="font-medium text-stone-800">{next ? formatDateLabel(next.dueDate) : "—"}</span>
        </p>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => setShowSchedule((value) => !value)}
          className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-stone-300 py-2 text-xs text-stone-600"
        >
          Ver cuotas <ChevronDown className={`h-3 w-3 ${showSchedule ? "rotate-180" : ""}`} />
        </button>
        {outstanding > 0 && (
          <button
            type="button"
            onClick={() => setShowPayment((value) => !value)}
            className="flex-1 rounded-lg bg-violet-600 py-2 text-xs font-medium text-white"
          >
            Registrar pago
          </button>
        )}
      </div>

      {loan.borrowedAvailableCents > 0 && (
        <button
          type="button"
          onClick={() => setShowReassign((value) => !value)}
          className="mt-2 w-full rounded-lg border border-violet-300 py-2 text-xs font-medium text-violet-700"
        >
          Reasignar fondos del préstamo
        </button>
      )}

      {showSchedule && <InstallmentList loan={loan} />}
      {showReassign && (
        <ReassignFundsForm
          userId={userId}
          loan={loan}
          onDone={() => setShowReassign(false)}
        />
      )}
      {showPayment && next && (
        <PaymentForm
          userId={userId}
          loan={loan}
          paymentMethods={paymentMethods}
          onDone={() => setShowPayment(false)}
        />
      )}
      {canCancel && !confirmCancel && (
        <button
          type="button"
          onClick={() => setConfirmCancel(true)}
          className="mt-3 text-xs text-red-600"
        >
          Cancelar préstamo sin usar
        </button>
      )}
      {confirmCancel && (
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs text-amber-800">
            Se quitará el dinero prestado del tope y también su registro de
            recepción. Esta opción solo funciona mientras no tenga usos ni pagos.
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => setConfirmCancel(false)} className="flex-1 rounded-lg border border-amber-300 py-1.5 text-xs text-amber-800">Volver</button>
            <button type="button" onClick={handleCancelLoan} className="flex-1 rounded-lg bg-red-600 py-1.5 text-xs font-medium text-white">Confirmar</button>
          </div>
        </div>
      )}
      {actionError && <p className="mt-2 text-xs text-red-600">{actionError}</p>}
      {(loan.fundMovementCount ?? 0) > 0 && (
        <LoanFundMovementList userId={userId} loanId={loan.id} />
      )}
    </article>
  );
}

function ReassignFundsForm({
  userId,
  loan,
  onDone,
}: {
  userId: string;
  loan: LoanWithId;
  onDone: () => void;
}) {
  const available = getBorrowedAvailableByCategory(loan);
  const defaultOrigin =
    available.necesidad > 0 ? "necesidad" : "ocio";
  const [origin, setOrigin] =
    useState<LoanDestinationCategory>(defaultOrigin);
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const destination: LoanDestinationCategory =
    origin === "necesidad" ? "ocio" : "necesidad";
  const amountCents = Math.round(Number(amount) * 100);
  const exceeds = amountCents > available[origin];

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await checkAndCloseMonth(userId);
      await reassignLoanFunds(userId, getMonthId(), loan.id, {
        origin,
        destination,
        amountCents,
      });
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo reasignar");
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 flex flex-col gap-3 rounded-xl bg-violet-50 p-3"
    >
      <p className="text-sm font-medium text-violet-900">
        Reasignar solo dinero prestado
      </p>
      <label className="text-sm text-stone-600">
        Desde
        <select
          value={origin}
          onChange={(event) =>
            setOrigin(event.target.value as LoanDestinationCategory)
          }
          className="mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-2"
        >
          <option value="necesidad" disabled={available.necesidad === 0}>
            Necesidad · {formatCents(available.necesidad)}
          </option>
          <option value="ocio" disabled={available.ocio === 0}>
            Ocio · {formatCents(available.ocio)}
          </option>
        </select>
      </label>
      <MoneyInput label="Monto" value={amount} onChange={setAmount} />
      <p className="text-xs text-violet-800">
        Pasará a {CATEGORY_META[destination].label}. Seguirá siendo dinero
        prestado y nunca se enviará a Ahorro.
      </p>
      {exceeds && (
        <p className="text-xs text-red-600">
          Supera el saldo prestado disponible en {CATEGORY_META[origin].label}.
        </p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={saving || amountCents <= 0 || exceeds}
        className="rounded-lg bg-violet-600 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {saving ? "Moviendo..." : "Confirmar reasignación"}
      </button>
    </form>
  );
}

function LoanFundMovementList({
  userId,
  loanId,
}: {
  userId: string;
  loanId: string;
}) {
  const [movements, setMovements] = useState<LoanFundMovementWithId[]>([]);

  useEffect(
    () =>
      watchLoanFundMovements(userId, loanId, setMovements, (error) => {
        console.error("watchLoanFundMovements falló:", error);
      }),
    [loanId, userId],
  );

  if (movements.length === 0) return null;
  return (
    <div className="mt-3 border-t border-stone-100 pt-3">
      <p className="text-xs font-medium text-stone-500">Reasignaciones</p>
      <div className="mt-2 flex flex-col gap-1">
        {movements.slice(0, 5).map((movement) => (
          <p key={movement.id} className="text-xs text-stone-500">
            {formatDateLabel(movement.transactionDate)} ·{" "}
            {CATEGORY_META[movement.origin].label} →{" "}
            {CATEGORY_META[movement.destination].label} ·{" "}
            {formatCents(movement.amountCents)}
          </p>
        ))}
      </div>
    </div>
  );
}

function InstallmentList({ loan }: { loan: LoanWithId }) {
  const today = toDateInputValue();
  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-stone-100 pt-3">
      {loan.installments.map((item) => {
        const status = getLoanInstallmentStatus(item, today);
        const label = {
          pending: "Pendiente",
          partial: "Parcial",
          paid: "Pagada",
          overdue: "Vencida",
        }[status];
        return (
          <div key={item.id} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-stone-400" />
              <span className="text-stone-600">Cuota {item.number} · {formatDateLabel(item.dueDate)}</span>
            </div>
            <div className="text-right">
              <p className="font-medium text-stone-900">{formatCents(item.amountCents)}</p>
              <p className={status === "overdue" ? "text-red-600" : status === "paid" ? "text-emerald-600" : "text-stone-400"}>
                {label}{item.paidCents > 0 && item.paidCents < item.amountCents ? ` · ${formatCents(item.paidCents)}` : ""}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PaymentForm({
  userId,
  loan,
  paymentMethods,
  onDone,
}: {
  userId: string;
  loan: LoanWithId;
  paymentMethods: { id: string; name: string }[];
  onDone: () => void;
}) {
  const today = toDateInputValue();
  const next = getNextPendingInstallment(loan)!;
  const [amount, setAmount] = useState(
    ((next.amountCents - next.paidCents) / 100).toFixed(2),
  );
  const [source, setSource] = useState<LoanPaymentSource>("necesidad");
  const [paymentDate, setPaymentDate] = useState(today);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountCents = Math.round(Number(amount) * 100);
  const preview = useMemo(() => {
    try {
      if (!Number.isFinite(amountCents) || amountCents <= 0) return [];
      return allocateLoanPayment(loan.installments, amountCents).allocations;
    } catch {
      return [];
    }
  }, [amountCents, loan.installments]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!paymentMethod) {
      setError("Selecciona un método de pago");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await checkAndCloseMonth(userId);
      await recordLoanPayment(userId, paymentDate.slice(0, 7), loan.id, {
        amountCents,
        paymentDate,
        sourceCategory: source,
        paymentMethod,
        description: description.trim() || undefined,
      });
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo registrar");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-3 rounded-xl bg-violet-50 p-3">
      <p className="text-sm font-medium text-violet-900">Confirmar pago</p>
      <MoneyInput label="Monto" value={amount} onChange={setAmount} />
      <label className="text-sm text-stone-600">
        Fecha del pago
        <input
          value={paymentDate}
          onChange={(event) => setPaymentDate(event.target.value)}
          type="date"
          max={today}
          className="mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-2"
        />
      </label>
      <label className="text-sm text-stone-600">
        Sale de
        <select value={source} onChange={(event) => setSource(event.target.value as LoanPaymentSource)} className="mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-2">
          <option value="necesidad">Necesidad</option>
          <option value="ocio">Ocio</option>
          <option value="ahorro">Ahorro sin asignar</option>
        </select>
      </label>
      <label className="text-sm text-stone-600">
        Método de pago
        <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} className="mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-2">
          <option value="">Selecciona uno</option>
          {paymentMethods.map((method) => <option key={method.id} value={method.name}>{method.name}</option>)}
        </select>
      </label>
      <label className="text-sm text-stone-600">
        Descripción <span className="text-stone-400">(opcional)</span>
        <input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={200} className="mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-2" />
      </label>
      {preview.length > 0 && (
        <p className="text-xs text-violet-800">
          Se aplicará primero a {preview.map((allocation) => loan.installments.find((item) => item.id === allocation.installmentId)?.number).filter(Boolean).map((number) => `cuota ${number}`).join(", ")}. Las fechas y montos originales no cambian.
        </p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button type="submit" disabled={saving || amountCents <= 0 || preview.length === 0} className="rounded-lg bg-violet-600 py-2 text-sm font-medium text-white disabled:opacity-50">
        {saving ? "Guardando..." : "Confirmar pago"}
      </button>
    </form>
  );
}
