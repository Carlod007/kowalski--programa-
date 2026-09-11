import { useEffect, useMemo, useState } from "react";
import { ChevronDown, CreditCard as CreditCardIcon, Plus } from "lucide-react";
import BackButton from "@/components/BackButton";
import { useAuthStore } from "@/store/authStore";
import { checkAndCloseMonth } from "@/services/monthService";
import {
  cancelLatestCreditCardStatement,
  confirmCreditCardStatement,
  createCreditCard,
  deleteCreditCardPayment,
  deleteUnusedCreditCard,
  recordCreditCardPayment,
  watchCreditCardPayments,
  watchCreditCardStatements,
  watchCreditCards,
} from "@/services/creditCardService";
import type {
  CreditCardPaymentMode,
  CreditCardPaymentWithId,
  CreditCardStatementWithId,
  CreditCardWithId,
} from "@/types/creditCard";
import {
  getAvailableCreditCents,
  getCreditCardDisplayName,
  getCreditCardStatementStatus,
  getDueDateForClosing,
  getMostRecentClosingDate,
} from "@/utils/creditCards";
import { formatCents } from "@/utils/currency";
import { formatDateLabel, getMonthId, toDateInputValue } from "@/utils/date";

export default function CreditCards() {
  const user = useAuthStore((state) => state.user);
  const [cards, setCards] = useState<CreditCardWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    if (!user) return;
    checkAndCloseMonth(user.uid).catch((error) => {
      console.error("checkAndCloseMonth falló:", error);
    });
    return watchCreditCards(
      user.uid,
      (nextCards) => {
        setCards(nextCards);
        setLoading(false);
      },
      (error) => {
        console.error("watchCreditCards falló:", error);
        setLoadError("No se pudieron cargar las tarjetas.");
        setLoading(false);
      },
    );
  }, [user]);

  if (!user) return null;

  const totalDebtCents = cards.reduce(
    (sum, card) => sum + card.currentDebtCents,
    0,
  );
  const totalAvailableCents = cards.reduce(
    (sum, card) => sum + Math.max(0, getAvailableCreditCents(card)),
    0,
  );

  return (
    <div className="min-h-dvh bg-stone-50 px-5 pb-10 pt-8">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <BackButton to="/dashboard" fixed />
          <div>
            <h1 className="text-2xl font-semibold text-stone-900">
              Tarjetas de crédito
            </h1>
            <p className="text-xs text-stone-400">
              Deuda revolvente, separada de tu presupuesto
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((value) => !value)}
          className="flex items-center gap-1 rounded-xl bg-sky-600 px-3 py-2 text-sm font-medium text-white"
        >
          <Plus size={15} /> {showCreate ? "Cerrar" : "Nueva"}
        </button>
      </header>

      <section className="mt-5 grid grid-cols-2 gap-3 rounded-2xl border border-sky-200 bg-white p-4">
        <div>
          <p className="text-xs text-stone-400">Deuda actual</p>
          <p className="mt-1 text-xl font-semibold text-sky-700">
            {formatCents(totalDebtCents)}
          </p>
        </div>
        <div>
          <p className="text-xs text-stone-400">Línea disponible total</p>
          <p className="mt-1 text-xl font-semibold text-stone-800">
            {formatCents(totalAvailableCents)}
          </p>
        </div>
      </section>

      {showCreate && (
        <CreateCreditCardForm
          userId={user.uid}
          onDone={() => setShowCreate(false)}
        />
      )}

      {loadError && <p className="mt-4 text-sm text-red-600">{loadError}</p>}

      <main className="mt-5 flex flex-col gap-4">
        {loading ? (
          <p className="py-8 text-center text-stone-400">Cargando...</p>
        ) : cards.length === 0 ? (
          <p className="py-8 text-center text-stone-400">
            Todavía no registraste tarjetas de crédito.
          </p>
        ) : (
          cards.map((card) => (
            <CreditCardCard key={card.id} card={card} userId={user.uid} />
          ))
        )}
      </main>
    </div>
  );
}

function CreateCreditCardForm({
  userId,
  onDone,
}: {
  userId: string;
  onDone: () => void;
}) {
  const [issuer, setIssuer] = useState("");
  const [name, setName] = useState("");
  const [limit, setLimit] = useState("");
  const [closingDay, setClosingDay] = useState("");
  const [dueDay, setDueDay] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createCreditCard(userId, {
        issuer,
        name,
        creditLimitCents: Math.round(parseFloat(limit) * 100),
        closingDay: Number(closingDay),
        dueDay: Number(dueDay),
      });
      onDone();
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "No se pudo registrar la tarjeta",
      );
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-4 flex flex-col gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4"
    >
      <p className="font-medium text-sky-900">Nueva tarjeta</p>
      <label className="flex flex-col gap-1 text-sm text-stone-600">
        Entidad
        <input
          value={issuer}
          onChange={(event) => setIssuer(event.target.value)}
          placeholder="BCP, Interbank, banco..."
          className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-stone-900"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-stone-600">
        Nombre de la tarjeta
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Visa Oro, Clásica..."
          className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-stone-900"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-stone-600">
        Línea de crédito (S/)
        <input
          type="number"
          inputMode="decimal"
          min="0.01"
          step="0.01"
          value={limit}
          onChange={(event) => setLimit(event.target.value)}
          className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-stone-900"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm text-stone-600">
          Día de corte
          <input
            type="number"
            min="1"
            max="31"
            value={closingDay}
            onChange={(event) => setClosingDay(event.target.value)}
            className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-stone-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-stone-600">
          Día de vencimiento
          <input
            type="number"
            min="1"
            max="31"
            value={dueDay}
            onChange={(event) => setDueDay(event.target.value)}
            className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-stone-900"
          />
        </label>
      </div>
      <p className="text-xs text-sky-700">
        Si un mes no tiene ese día, se usará su último día.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={saving}
        className="rounded-xl bg-sky-600 py-2.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {saving ? "Guardando..." : "Registrar tarjeta"}
      </button>
    </form>
  );
}

function CreditCardCard({
  card,
  userId,
}: {
  card: CreditCardWithId;
  userId: string;
}) {
  const [openPanel, setOpenPanel] = useState<
    "statement" | "payment" | "history" | null
  >(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const today = toDateInputValue();
  const availableCents = getAvailableCreditCents(card);
  const active = card.activeStatement;
  const status = active
    ? getCreditCardStatementStatus(active, today)
    : null;

  function togglePanel(panel: "statement" | "payment" | "history") {
    setConfirmDelete(false);
    setActionError(null);
    setOpenPanel((current) => (current === panel ? null : panel));
  }

  async function handleDelete() {
    setActionError(null);
    try {
      await deleteUnusedCreditCard(userId, card.id);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "No se pudo borrar la tarjeta",
      );
      setConfirmDelete(false);
    }
  }

  return (
    <article className="rounded-2xl border border-stone-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <span className="rounded-xl bg-sky-50 p-2 text-sky-600">
            <CreditCardIcon size={18} />
          </span>
          <div>
            <p className="font-semibold text-stone-900">
              {getCreditCardDisplayName(card)}
            </p>
            <p className="text-xs text-stone-400">
              Corte: día {card.closingDay} · vence: día {card.dueDay}
            </p>
          </div>
        </div>
        <span className="rounded-full bg-sky-50 px-2 py-1 text-xs font-medium text-sky-700">
          {formatCents(card.currentDebtCents)} deuda
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <p className="text-stone-500">
          Línea: <span className="font-medium text-stone-800">{formatCents(card.creditLimitCents)}</span>
        </p>
        <p className="text-stone-500">
          Disponible: <span className="font-medium text-stone-800">{formatCents(Math.max(0, availableCents))}</span>
        </p>
      </div>

      {availableCents < 0 && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
          Aviso: la deuda supera la línea registrada por {formatCents(-availableCents)}.
        </p>
      )}

      {active ? (
        <div className="mt-3 rounded-xl bg-stone-50 p-3 text-xs">
          <div className="flex items-center justify-between gap-3">
            <span className="text-stone-500">
              Vence {formatDateLabel(active.dueDate)}
            </span>
            <StatementStatusLabel status={status!} />
          </div>
          <div className="mt-2 flex justify-between text-stone-600">
            <span>Mínimo: {formatCents(active.minimumPaymentCents)}</span>
            <span>Total: {formatCents(active.totalPaymentCents)}</span>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-stone-400">
          Sin estado de cuenta confirmado.
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => togglePanel("statement")}
          className="rounded-lg border border-sky-300 py-2 text-xs font-medium text-sky-700"
        >
          Confirmar estado
        </button>
        <button
          type="button"
          disabled={card.currentDebtCents <= 0}
          onClick={() => togglePanel("payment")}
          className="rounded-lg bg-sky-600 py-2 text-xs font-medium text-white disabled:opacity-40"
        >
          Registrar pago
        </button>
      </div>
      <button
        type="button"
        onClick={() => togglePanel("history")}
        className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-stone-300 py-2 text-xs text-stone-600"
      >
        Historial <ChevronDown size={13} className={openPanel === "history" ? "rotate-180" : ""} />
      </button>

      {openPanel === "statement" && (
        <StatementForm
          card={card}
          userId={userId}
          onDone={() => setOpenPanel(null)}
        />
      )}
      {openPanel === "payment" && (
        <CardPaymentForm
          card={card}
          userId={userId}
          onDone={() => setOpenPanel(null)}
        />
      )}
      {openPanel === "history" && (
        <CardHistory card={card} userId={userId} />
      )}

      {card.currentDebtCents === 0 && !card.activeStatement && !confirmDelete && (
        <button
          type="button"
          onClick={() => {
            setOpenPanel(null);
            setConfirmDelete(true);
          }}
          className="mt-3 text-xs text-red-600"
        >
          Eliminar tarjeta sin actividad
        </button>
      )}
      {confirmDelete && (
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs text-amber-800">
            Solo se eliminará si no tiene compras, estados ni pagos.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="flex-1 rounded-lg border border-amber-300 py-1.5 text-xs text-amber-800"
            >
              Volver
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="flex-1 rounded-lg bg-red-600 py-1.5 text-xs font-medium text-white"
            >
              Confirmar
            </button>
          </div>
        </div>
      )}
      {actionError && <p className="mt-2 text-xs text-red-600">{actionError}</p>}
    </article>
  );
}

function StatementStatusLabel({
  status,
}: {
  status: ReturnType<typeof getCreditCardStatementStatus>;
}) {
  const labels = {
    pending: "Pendiente",
    overdue: "Pago mínimo vencido",
    "minimum-covered": "Mínimo cubierto · saldo pendiente",
    paid: "Pagado",
  } as const;
  return (
    <span className={status === "overdue" ? "font-medium text-red-600" : "font-medium text-sky-700"}>
      {labels[status]}
    </span>
  );
}

function StatementForm({
  card,
  userId,
  onDone,
}: {
  card: CreditCardWithId;
  userId: string;
  onDone: () => void;
}) {
  const initialClosingDate = useMemo(
    () => getMostRecentClosingDate(card.closingDay),
    [card.closingDay],
  );
  const [closingDate, setClosingDate] = useState(initialClosingDate);
  const [dueDate, setDueDate] = useState(
    getDueDateForClosing(initialClosingDate, card.dueDay),
  );
  const [statementBalance, setStatementBalance] = useState("");
  const [minimumPayment, setMinimumPayment] = useState("");
  const [totalPayment, setTotalPayment] = useState("");
  const [interestCharges, setInterestCharges] = useState("0");
  const [totalEdited, setTotalEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClosingDateChange(value: string) {
    setClosingDate(value);
    if (value) setDueDate(getDueDateForClosing(value, card.dueDay));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await checkAndCloseMonth(userId);
      await confirmCreditCardStatement(userId, card.id, {
        closingDate,
        dueDate,
        statementBalanceCents: Math.round(parseFloat(statementBalance) * 100),
        minimumPaymentCents: Math.round(parseFloat(minimumPayment) * 100),
        totalPaymentCents: Math.round(parseFloat(totalPayment) * 100),
        interestChargesCents: Math.round(
          (parseFloat(interestCharges) || 0) * 100,
        ),
        recordedMonthId: getMonthId(),
        recordedDate: toDateInputValue(),
      });
      onDone();
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "No se pudo confirmar el estado de cuenta",
      );
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 flex flex-col gap-3 rounded-xl border border-sky-200 bg-sky-50 p-3"
    >
      <p className="text-sm font-medium text-sky-900">
        Confirmar estado de cuenta
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs text-stone-600">
          Fecha de corte
          <input
            type="date"
            value={closingDate}
            onChange={(event) => handleClosingDateChange(event.target.value)}
            className="rounded-lg border border-sky-200 bg-white px-2 py-2 text-stone-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-stone-600">
          Vencimiento
          <input
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            className="rounded-lg border border-sky-200 bg-white px-2 py-2 text-stone-900"
          />
        </label>
      </div>
      <MoneyInput
        label="Saldo facturado (S/)"
        value={statementBalance}
        onChange={(value) => {
          setStatementBalance(value);
          if (!totalEdited) setTotalPayment(value);
        }}
      />
      <div className="grid grid-cols-2 gap-2">
        <MoneyInput
          label="Pago mínimo (S/)"
          value={minimumPayment}
          onChange={setMinimumPayment}
        />
        <MoneyInput
          label="Pago total (S/)"
          value={totalPayment}
          onChange={(value) => {
            setTotalEdited(true);
            setTotalPayment(value);
          }}
        />
      </div>
      <MoneyInput
        label="Intereses y cargos incluidos (S/)"
        value={interestCharges}
        onChange={setInterestCharges}
      />
      <p className="text-xs text-sky-700">
        Los intereses y cargos se registrarán como gasto de Necesidad hoy.
        El pago posterior no consumirá presupuesto nuevamente.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={saving}
        className="rounded-lg bg-sky-600 py-2 text-xs font-medium text-white disabled:opacity-50"
      >
        {saving ? "Guardando..." : "Confirmar estado"}
      </button>
    </form>
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
    <label className="flex flex-col gap-1 text-xs text-stone-600">
      {label}
      <input
        type="number"
        inputMode="decimal"
        min="0"
        step="0.01"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-lg border border-sky-200 bg-white px-2 py-2 text-stone-900"
      />
    </label>
  );
}

function CardPaymentForm({
  card,
  userId,
  onDone,
}: {
  card: CreditCardWithId;
  userId: string;
  onDone: () => void;
}) {
  const active = card.activeStatement;
  const remainingTotal = active
    ? Math.max(0, active.totalPaymentCents - active.paidCents)
    : card.currentDebtCents;
  const remainingMinimum = active
    ? Math.max(0, active.minimumPaymentCents - active.paidCents)
    : 0;
  const [mode, setMode] = useState<CreditCardPaymentMode>(
    active ? "total" : "other",
  );
  const [amount, setAmount] = useState(
    active ? (Math.min(card.currentDebtCents, remainingTotal) / 100).toFixed(2) : "",
  );
  const [paymentDate, setPaymentDate] = useState(toDateInputValue());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function selectMode(nextMode: CreditCardPaymentMode) {
    setMode(nextMode);
    if (nextMode === "total") {
      setAmount(
        (Math.min(card.currentDebtCents, remainingTotal) / 100).toFixed(2),
      );
    } else if (nextMode === "minimum") {
      setAmount(
        (Math.min(card.currentDebtCents, remainingMinimum) / 100).toFixed(2),
      );
    } else {
      setAmount("");
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await recordCreditCardPayment(userId, card.id, {
        amountCents: Math.round(parseFloat(amount) * 100),
        paymentDate,
        mode,
      });
      onDone();
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "No se pudo registrar el pago",
      );
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 flex flex-col gap-3 rounded-xl border border-sky-200 bg-sky-50 p-3"
    >
      <p className="text-sm font-medium text-sky-900">Registrar pago</p>
      <div className="grid grid-cols-3 gap-2">
        {active && (
          <>
            <PaymentModeButton
              label="Total"
              active={mode === "total"}
              onClick={() => selectMode("total")}
            />
            <PaymentModeButton
              label="Mínimo"
              active={mode === "minimum"}
              disabled={remainingMinimum === 0}
              onClick={() => selectMode("minimum")}
            />
          </>
        )}
        <PaymentModeButton
          label="Otro"
          active={mode === "other"}
          onClick={() => selectMode("other")}
        />
      </div>
      <MoneyInput label="Monto (S/)" value={amount} onChange={setAmount} />
      <label className="flex flex-col gap-1 text-xs text-stone-600">
        Fecha del pago
        <input
          type="date"
          value={paymentDate}
          onChange={(event) => setPaymentDate(event.target.value)}
          className="rounded-lg border border-sky-200 bg-white px-2 py-2 text-stone-900"
        />
      </label>
      <p className="text-xs text-sky-700">
        Este pago solo reducirá la deuda. No se descontará nuevamente de
        Necesidad, Ocio ni Ahorro.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={saving}
        className="rounded-lg bg-sky-600 py-2 text-xs font-medium text-white disabled:opacity-50"
      >
        {saving ? "Guardando..." : "Confirmar pago"}
      </button>
    </form>
  );
}

function PaymentModeButton({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg border py-2 text-xs disabled:opacity-40 ${
        active
          ? "border-sky-600 bg-sky-600 text-white"
          : "border-sky-200 bg-white text-sky-700"
      }`}
    >
      {label}
    </button>
  );
}

function CardHistory({
  card,
  userId,
}: {
  card: CreditCardWithId;
  userId: string;
}) {
  const [statements, setStatements] = useState<CreditCardStatementWithId[]>([]);
  const [payments, setPayments] = useState<CreditCardPaymentWithId[]>([]);
  const [confirmStatementId, setConfirmStatementId] = useState<string | null>(
    null,
  );
  const [confirmPaymentId, setConfirmPaymentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stopStatements = watchCreditCardStatements(
      userId,
      card.id,
      setStatements,
      (watchError) => {
        console.error("watchCreditCardStatements falló:", watchError);
        setError("No se pudieron cargar los estados de cuenta");
      },
    );
    const stopPayments = watchCreditCardPayments(
      userId,
      card.id,
      setPayments,
      (watchError) => {
        console.error("watchCreditCardPayments falló:", watchError);
        setError("No se pudieron cargar los pagos");
      },
    );
    return () => {
      stopStatements();
      stopPayments();
    };
  }, [card.id, userId]);

  async function cancelStatement(statementId: string) {
    setError(null);
    try {
      await cancelLatestCreditCardStatement(userId, card.id, statementId);
      setConfirmStatementId(null);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "No se pudo corregir el estado",
      );
      setConfirmStatementId(null);
    }
  }

  async function deletePayment(paymentId: string) {
    setError(null);
    try {
      await deleteCreditCardPayment(userId, card.id, paymentId);
      setConfirmPaymentId(null);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "No se pudo borrar el pago",
      );
      setConfirmPaymentId(null);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-stone-400">
        Estados de cuenta
      </p>
      {statements.length === 0 ? (
        <p className="mt-2 text-xs text-stone-400">Sin estados confirmados.</p>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          {statements.slice(0, 6).map((statement) => (
            <div key={statement.id} className="rounded-lg bg-white p-2 text-xs">
              {confirmStatementId === statement.id ? (
                <div>
                  <p className="text-amber-700">
                    Se revertirán los intereses y cargos de este estado.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmStatementId(null)}
                      className="flex-1 rounded border border-stone-300 py-1.5 text-stone-600"
                    >
                      Volver
                    </button>
                    <button
                      type="button"
                      onClick={() => cancelStatement(statement.id)}
                      className="flex-1 rounded bg-red-600 py-1.5 font-medium text-white"
                    >
                      Confirmar
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex justify-between gap-3">
                    <span className="text-stone-500">
                      Corte {formatDateLabel(statement.closingDate)}
                    </span>
                    <span className="font-medium text-stone-800">
                      {formatCents(statement.totalPaymentCents)}
                    </span>
                  </div>
                  <p className="mt-1 text-stone-400">
                    Pagado {formatCents(statement.paidCents)} · intereses{" "}
                    {formatCents(statement.interestChargesCents)}
                  </p>
                  {card.activeStatement?.id === statement.id &&
                    statement.paidCents === 0 && (
                      <button
                        type="button"
                        onClick={() => setConfirmStatementId(statement.id)}
                        className="mt-1 text-red-600"
                      >
                        Corregir este estado
                      </button>
                    )}
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs font-medium uppercase tracking-wide text-stone-400">
        Pagos
      </p>
      {payments.length === 0 ? (
        <p className="mt-2 text-xs text-stone-400">Sin pagos registrados.</p>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          {payments.slice(0, 8).map((payment) => (
            <div key={payment.id} className="rounded-lg bg-white p-2 text-xs">
              {confirmPaymentId === payment.id ? (
                <div>
                  <p className="text-amber-700">
                    La deuda aumentará nuevamente en {formatCents(payment.amountCents)}.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmPaymentId(null)}
                      className="flex-1 rounded border border-stone-300 py-1.5 text-stone-600"
                    >
                      Volver
                    </button>
                    <button
                      type="button"
                      onClick={() => deletePayment(payment.id)}
                      className="flex-1 rounded bg-red-600 py-1.5 font-medium text-white"
                    >
                      Confirmar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-stone-500">
                      {formatDateLabel(payment.paymentDate)}
                    </p>
                    <p className="text-stone-400">
                      {payment.mode === "total"
                        ? "Pago total"
                        : payment.mode === "minimum"
                          ? "Pago mínimo"
                          : "Otro monto"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium text-emerald-700">
                      - {formatCents(payment.amountCents)}
                    </p>
                    {(!payment.statementId ||
                      payment.statementId === card.activeStatement?.id) && (
                      <button
                        type="button"
                        onClick={() => setConfirmPaymentId(payment.id)}
                        className="mt-1 text-red-600"
                      >
                        Borrar
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
