import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  doc,
  onSnapshot,
} from "firebase/firestore";
import {
  Calendar,
  Download,
  MoreVertical,
  ArrowDown,
  ArrowUp,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/store/authStore";
import {
  getMonthId,
  shiftMonthId,
  formatMonthLabel,
  formatDayMonth,
  formatTime24,
  toDateInputValue,
} from "@/utils/date";
import { formatCents } from "@/utils/currency";
import { CATEGORY_META } from "@/utils/category";
import { deleteTransaction } from "@/services/transactionService";
import {
  getAvailableMonths,
  buildHistoryCsv,
  downloadCsv,
} from "@/services/exportService";
import BottomNav from "@/components/BottomNav";
import type { Month } from "@/types/month";
import type {
  Category,
  Transaction,
} from "@/types/transaction";
import BackButton from "@/components/BackButton";
import TransactionDateTimeFields from "@/components/TransactionDateTimeFields";
import { updateTransactionTiming } from "@/services/transactionTimingService";
import { canEditTransactionTiming, compareRecordedTiming, getRecordedDate } from "@/utils/transactionTiming";
import {
  getAvailableExpenseTags,
  hasExpenseTag,
} from "@/utils/expenseTags";

type Filter = "all" | "income" | "loan" | "credit-card" | Category;

type TxWithId = Transaction & { _id: string };

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "income", label: "Ingresos" },
  { key: "loan", label: "Préstamos" },
  { key: "credit-card", label: "Tarjetas" },
  { key: "necesidad", label: "Necesidad" },
  { key: "ocio", label: "Ocio" },
  { key: "ahorro", label: "Ahorro" },
];

const SHORT_MONTHS = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
];

const CURRENT_MONTH_ID = getMonthId();

export default function History() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();

  const [viewedMonthId, setViewedMonthId] = useState(CURRENT_MONTH_ID);
  const [month, setMonth] = useState<Month | null>(null);
  const [loadedMonthId, setLoadedMonthId] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<TxWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [timingTx, setTimingTx] = useState<TxWithId | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);

  const isClosed = month?.closed === true;

  useEffect(() => {
    if (!user) return;

    const monthRef = doc(db, "users", user.uid, "months", viewedMonthId);
    const txRef = collection(db, "users", user.uid, "months", viewedMonthId, "transactions");

    const unsubMonth = onSnapshot(
      monthRef,
      (snap) => {
        setMonth(snap.exists() ? (snap.data() as Month) : null);
        setLoadedMonthId(viewedMonthId);
        setLoading(false);
      },
      (err) => {
        console.error("onSnapshot mes falló:", err);
        setLoadedMonthId(null);
        setLoading(false);
      },
    );

    const unsubTx = onSnapshot(txRef, (snap) => {
      const txs = snap.docs.map((d) => ({
        ...(d.data() as Transaction),
        _id: d.id,
      }));
      setTransactions(txs.sort((a, b) => compareRecordedTiming(b, a) || a._id.localeCompare(b._id)));
    });

    return () => {
      unsubMonth();
      unsubTx();
    };
  }, [user, viewedMonthId]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    }
    if (openMenuId) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [openMenuId]);

  const availableTags = getAvailableExpenseTags(
    transactions.filter((tx) => tx.type === "expense"),
  );
  const filtered = transactions.filter((tx) => {
    let matchesMainFilter: boolean;
    if (filter === "all") matchesMainFilter = true;
    else if (filter === "income") matchesMainFilter = tx.type === "income";
    else if (filter === "loan") {
      matchesMainFilter =
        tx.type === "loan" ||
        (tx.type === "expense" && !!(tx.loanId || tx.fundedByLoanId));
    } else if (filter === "credit-card") {
      matchesMainFilter = tx.type === "expense" && !!tx.creditCardId;
    } else {
      matchesMainFilter = tx.type === "expense" && tx.category === filter;
    }
    if (!matchesMainFilter) return false;
    if (!selectedTag) return true;
    return tx.type === "expense" && hasExpenseTag(tx.tags, selectedTag);
  });

  const grouped = groupByDate(filtered);

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center text-stone-400">
        Cargando...
      </div>
    );
  }

  async function handleDelete(txId: string) {
    if (!user) return;
    setDeleteError(null);
    try {
      await deleteTransaction(user.uid, viewedMonthId, txId);
      setDeletingId(null);
      setOpenMenuId(null);
    } catch (err) {
      console.error("deleteTransaction falló:", err);
      setDeleteError(
        err instanceof Error
          ? err.message
          : "No se pudo borrar. Intenta de nuevo.",
      );
      setDeletingId(null);
      setOpenMenuId(null);
    }
  }

  return (
    <div className="min-h-dvh bg-stone-50 pb-24">
      <header className="px-5 pt-8">
        <BackButton to="/dashboard" fixed />
        <div className="mt-4 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-stone-900">Historial</h1>
          <button
            type="button"
            onClick={() => setShowExport((v) => !v)}
            aria-label="Exportar historial"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-stone-200 bg-white text-emerald-600"
          >
            <Download size={18} />
          </button>
        </div>
      </header>

      {user && showExport && (
        <ExportPanel
          userId={user.uid}
          onClose={() => setShowExport(false)}
        />
      )}

      {deleteError && (
        <div className="mx-5 mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs text-amber-800">{deleteError}</p>
          <button
            type="button"
            onClick={() => setDeleteError(null)}
            className="mt-2 text-xs font-medium text-amber-800 underline"
          >
            Entendido
          </button>
        </div>
      )}

      <div className="flex items-center justify-center px-5 pt-5">
        <div className="flex items-center gap-2 rounded-full bg-stone-100 px-2 py-1.5">
          <button
            type="button"
            onClick={() => setViewedMonthId((id) => shiftMonthId(id, -1))}
            className="flex h-6 w-6 items-center justify-center rounded-full text-stone-500"
          >
            ‹
          </button>
          <Calendar size={16} className="text-emerald-600" />
          <span className="text-sm font-semibold text-stone-900">
            {formatMonthLabel(viewedMonthId)}
          </span>
          <button
            type="button"
            onClick={() => setViewedMonthId((id) => shiftMonthId(id, 1))}
            disabled={viewedMonthId >= CURRENT_MONTH_ID}
            className="flex h-6 w-6 items-center justify-center rounded-full text-stone-500 disabled:opacity-30"
          >
            ›
          </button>
        </div>
      </div>

      {isClosed && (
        <p className="mt-3 px-5 text-center text-sm text-stone-500">
          Mes cerrado - solo lectura
        </p>
      )}

      <div className="mt-4 flex gap-2 overflow-x-auto px-5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
              filter === f.key
                ? "border-emerald-600 bg-emerald-600 text-white"
                : "border-stone-200 bg-white text-stone-700"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {availableTags.length > 0 && (
        <div className="mt-3 flex gap-2 overflow-x-auto px-5">
          <button
            type="button"
            onClick={() => setSelectedTag(null)}
            className={`whitespace-nowrap rounded-full px-3 py-1 text-xs ${
              selectedTag === null
                ? "bg-stone-800 text-white"
                : "bg-stone-100 text-stone-600"
            }`}
          >
            Todas las etiquetas
          </button>
          {availableTags.map((tag) => (
            <button
              key={tag.toLocaleLowerCase("es")}
              type="button"
              onClick={() => setSelectedTag(tag)}
              className={`whitespace-nowrap rounded-full px-3 py-1 text-xs ${
                selectedTag?.toLocaleLowerCase("es") ===
                tag.toLocaleLowerCase("es")
                  ? "bg-teal-600 text-white"
                  : "bg-teal-50 text-teal-700"
              }`}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

      <main className="mt-4 flex flex-col gap-3 px-5">
        {grouped.length === 0 ? (
          <p className="py-8 text-center text-stone-400">
            No hay transacciones en este mes
          </p>
        ) : (
          grouped.map((group) => (
            <div key={group.label}>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-400">
                {group.label}
              </p>
              <div className="flex flex-col gap-2">
                {group.items.map((tx) => {
                  const isDeleting = deletingId === tx._id;
                  const isOpen = loadedMonthId === viewedMonthId
                    && viewedMonthId === getMonthId()
                    && month?.closed === false;

                  if (isDeleting) {
                    return (
                      <div
                        key={tx._id}
                        className="rounded-2xl border border-amber-300 bg-amber-50 p-4"
                      >
                        <p className="text-sm text-amber-800">
                          Esta acción no se puede deshacer y el monto se
                          revertirá de tus topes o ahorro. ¿Borrar esta
                          transacción?
                        </p>
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={() => setDeletingId(null)}
                            className="flex-1 rounded-lg border border-amber-300 py-2 text-sm font-medium text-amber-800"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(tx._id)}
                            className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-medium text-white"
                          >
                            Borrar
                          </button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <TransactionRow
                      key={tx._id}
                      tx={tx}
                      isOpen={isOpen}
                      isMenuOpen={openMenuId === tx._id}
                      onToggleMenu={() =>
                        setOpenMenuId(openMenuId === tx._id ? null : tx._id)
                      }
                      onEditTiming={() => { setOpenMenuId(null); setTimingTx(tx); }}
                      onEdit={() =>
                        navigate(`/history/edit/${viewedMonthId}/${tx._id}`)
                      }
                      onDelete={() => {
                        setDeletingId(tx._id);
                        setOpenMenuId(null);
                      }}
                      menuRef={menuRef}
                    />
                  );
                })}
              </div>
            </div>
          ))
        )}
      </main>

      {timingTx && user && loadedMonthId === viewedMonthId
        && viewedMonthId === getMonthId() && month?.closed === false && (
        <TimingEditor key={timingTx._id} tx={timingTx} userId={user.uid}
          monthId={viewedMonthId} onClose={() => setTimingTx(null)} />
      )}
      <BottomNav />
    </div>
  );
}

function TransactionRow({
  tx,
  isOpen,
  isMenuOpen,
  onToggleMenu,
  onEditTiming,
  onEdit,
  onDelete,
  menuRef,
}: {
  tx: TxWithId;
  isOpen: boolean;
  isMenuOpen: boolean;
  onToggleMenu: () => void;
  onEdit: () => void;
  onEditTiming: () => void;
  onDelete: () => void;
  menuRef: React.RefObject<HTMLDivElement | null>;
}) {
  const isIncome = tx.type === "income";
  const isLoanReceipt = tx.type === "loan";
  const isLoanExpense =
    tx.type === "expense" && !!(tx.loanId || tx.fundedByLoanId);
  const isCardStatementCharge =
    tx.type === "expense" && !!tx.creditCardStatementId;
  const canEdit = !isLoanReceipt && !isLoanExpense && !isCardStatementCharge;
  const name = isIncome
    ? tx.source
    : isLoanReceipt
      ? tx.lender?.trim() || "Préstamo recibido"
      : tx.subcategory;
  const detail = isIncome
    ? tx.description
    : isLoanReceipt
      ? tx.description === "Préstamo anterior incorporado"
        ? "Préstamo anterior incorporado"
        : "Préstamo recibido"
      : tx.fundedByLoanId
        ? `${CATEGORY_META[tx.category].label} · financiado con ${tx.fundedByLoanName ?? "préstamo"}${tx.description ? ` · ${tx.description}` : ""}`
        : tx.loanPaymentId
          ? `${CATEGORY_META[tx.category].label} · pago de préstamo`
          : tx.creditCardId
            ? tx.creditCardChargeKind === "interest-fees"
              ? `${CATEGORY_META[tx.category].label} · intereses/cargos de ${tx.creditCardName ?? "tarjeta"}`
              : `${CATEGORY_META[tx.category].label} · tarjeta ${tx.creditCardName ?? "de crédito"}`
          : tx.description
            ? `${CATEGORY_META[tx.category].label} - ${tx.description}`
            : CATEGORY_META[tx.category].label;
  const isPositive = isIncome || isLoanReceipt;
  const recorded = getRecordedDate(tx);
  const recordedDay = recorded ? toDateInputValue(recorded) : null;
  const isPastDated = recordedDay === null || tx.transactionDate !== recordedDay;

  return (
    <div className="relative rounded-2xl border border-stone-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
            isPositive
              ? "bg-emerald-50 text-emerald-600"
              : "bg-red-50 text-red-600"
          }`}
        >
          {isPositive ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
        </span>

        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-semibold text-stone-900">
            {name}
          </p>
          {detail && <p className="mt-0.5 text-xs text-stone-400">{detail}</p>}
          {isPastDated && (
            <p className="mt-1 text-sm font-medium text-stone-800">
              Operación: {formatDayMonth(tx.transactionDate)}
            </p>
          )}
          <p className={`mt-0.5 text-xs ${isPastDated ? "text-stone-400" : "text-stone-500"}`}>
            {recorded && recordedDay
              ? `Registrado el ${formatDayMonth(recordedDay)} ${formatTime24(recorded)}`
              : "Momento de registro no disponible"}
          </p>
          {tx.type === "expense" && (
            <p className="mt-0.5 text-xs text-stone-400">{tx.paymentMethod}</p>
          )}
          {tx.type === "expense" && (tx.tags?.length ?? 0) > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {tx.tags!.map((tag) => (
                <span
                  key={tag.toLocaleLowerCase("es")}
                  className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] text-teal-700"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="grid shrink-0 grid-cols-[auto_1.5rem] items-start gap-2">
          <span
            className={`whitespace-nowrap pt-0.5 text-right text-sm font-medium ${
              isPositive ? "text-emerald-600" : "text-red-600"
            }`}
          >
            {isPositive ? "+ " : "- "}
            {formatCents(tx.amountCents)}
          </span>
          <div
            className="relative h-6 w-6"
            ref={isMenuOpen ? menuRef : undefined}
          >
            {isOpen && !isLoanReceipt && !isCardStatementCharge && (
              <>
                <button
                  type="button"
                  onClick={onToggleMenu}
                  className="flex h-6 w-6 items-center justify-center text-stone-400"
                >
                  <MoreVertical size={16} />
                </button>
                {isMenuOpen && (
                  <div className="absolute right-0 top-8 z-10 w-36 rounded-xl border border-stone-200 bg-white py-1 shadow-lg">
                    {canEditTransactionTiming(tx) && (
                      <button type="button" onClick={onEditTiming}
                        className="w-full px-3 py-2 text-left text-sm text-stone-700 hover:bg-stone-50">
                        Fecha
                      </button>
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={onEdit}
                        className="w-full px-3 py-2 text-left text-sm text-stone-700 hover:bg-stone-50"
                      >
                        Editar
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={onDelete}
                      className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-stone-50"
                    >
                      Borrar
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TimingEditor({ tx, userId, monthId, onClose }: {
  tx: TxWithId;
  userId: string;
  monthId: string;
  onClose: () => void;
}) {
  const [date, setDate] = useState(tx.transactionDate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await updateTransactionTiming(userId, monthId, tx._id, date);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo corregir la fecha.");
      setSaving(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-5">
      <form onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="timing-title"
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-lg">
        <h2 id="timing-title" className="mb-4 text-lg font-semibold text-stone-900">Corregir fecha</h2>
        <TransactionDateTimeFields date={date} onDateChange={setDate} editing />
        <p className="mt-3 text-xs text-stone-500">El monto, los saldos y la fecha original de registro se conservan.</p>
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-4 flex gap-3">
          <button type="button" disabled={saving} onClick={onClose}
            className="flex-1 rounded-xl border border-stone-300 py-2 text-sm text-stone-700">Cancelar</button>
          <button type="submit" disabled={saving}
            className="flex-1 rounded-xl bg-emerald-600 py-2 text-sm font-medium text-white disabled:opacity-50">
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </div>
  );
}

function groupByDate(transactions: TxWithId[]): {
  label: string;
  items: TxWithId[];
}[] {
  const today = toDateInputValue();
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = toDateInputValue(yesterdayDate);

  const map = new Map<string, TxWithId[]>();

  for (const tx of transactions) {
    const recorded = getRecordedDate(tx);
    const d = recorded ? toDateInputValue(recorded) : tx.transactionDate;
    if (!map.has(d)) map.set(d, []);
    map.get(d)!.push(tx);
  }

  const result: { label: string; items: TxWithId[] }[] = [];

  for (const [date, items] of map) {
    let label: string;
    if (date === today) {
      label = "HOY";
    } else if (date === yesterday) {
      label = "AYER";
    } else {
      const [, month, day] = date.split("-").map(Number);
      label = `${day} ${SHORT_MONTHS[month - 1]}`;
    }
    result.push({ label, items });
  }

  return result;
}

function ExportPanel({
  userId,
  onClose,
}: {
  userId: string;
  onClose: () => void;
}) {
  const [months, setMonths] = useState<string[]>([]);
  const [fromMonth, setFromMonth] = useState("");
  const [toMonth, setToMonth] = useState("");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAvailableMonths(userId).then((result) => {
      if (cancelled) return;
      setMonths(result);
      if (result.length > 0) {
        setFromMonth(result[0]);
        setToMonth(result[result.length - 1]);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function handleExport(format: "xlsx" | "csv") {
    if (!fromMonth || !toMonth) return;
    setExporting(true);
    setError(null);
    try {
      if (format === "xlsx") {
        const { exportHistoryXlsx, downloadXlsx } = await import("@/services/historyXlsxService");
        const xlsx = await exportHistoryXlsx(userId, fromMonth, toMonth);
        const period = fromMonth === toMonth ? fromMonth : `${fromMonth}-a-${toMonth}`;
        downloadXlsx(xlsx, `kowalski-historial-${period}.xlsx`);
      } else {
        const csv = await buildHistoryCsv(userId, fromMonth, toMonth);
        downloadCsv(csv, `kowalski_${fromMonth}_a_${toMonth}.csv`);
      }
      onClose();
    } catch (err) {
      console.error("Error al exportar:", err);
      setError("No se pudo generar el archivo. Intenta de nuevo.");
    } finally {
      setExporting(false);
    }
  }

  const hasMultipleMonths = months.length > 1;
  const rangeInvalid = fromMonth > toMonth;

  return (
    <div className="mx-5 mt-3 rounded-2xl border border-stone-200 bg-white p-4">
      {loading ? (
        <p className="text-sm text-stone-400">Cargando meses...</p>
      ) : (
        <>
          <p className="text-sm font-medium text-stone-900">
            Exportar historial
          </p>

          {hasMultipleMonths ? (
            <div className="mt-3 flex items-center gap-2">
              <select
                value={fromMonth}
                onChange={(e) => setFromMonth(e.target.value)}
                className="flex-1 rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
              >
                {months.map((m) => (
                  <option key={m} value={m}>
                    {formatMonthLabel(m)}
                  </option>
                ))}
              </select>
              <span className="text-xs text-stone-400">a</span>
              <select
                value={toMonth}
                onChange={(e) => setToMonth(e.target.value)}
                className="flex-1 rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
              >
                {months.map((m) => (
                  <option key={m} value={m}>
                    {formatMonthLabel(m)}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="mt-2 text-xs text-stone-400">
              Solo hay un mes disponible: {formatMonthLabel(fromMonth)}
            </p>
          )}

          {rangeInvalid && (
            <p className="mt-2 text-xs text-red-500">
              &quot;Desde&quot; no puede ser posterior a &quot;Hasta&quot;
            </p>
          )}
          {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => handleExport("xlsx")}
              disabled={exporting || rangeInvalid || !fromMonth || !toMonth}
              className="w-full rounded-lg bg-emerald-700 px-3 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {exporting ? "Generando..." : "Exportar Excel (.xlsx)"}
            </button>
            <button
              type="button"
              onClick={() => handleExport("csv")}
              disabled={exporting || rangeInvalid || !fromMonth || !toMonth}
              className="w-full rounded-lg border border-stone-300 px-3 py-2.5 text-sm font-medium text-stone-700 disabled:opacity-50"
            >
              Exportar CSV
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={exporting}
              className="w-full py-1 text-sm text-stone-500 disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </>
      )}
    </div>
  );
}
