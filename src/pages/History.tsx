import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  doc,
  onSnapshot,
  query,
  orderBy,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/store/authStore";
import {
  getMonthId,
  shiftMonthId,
  formatMonthLabel,
  toDateInputValue,
} from "@/utils/date";
import { formatCents } from "@/utils/currency";
import { CATEGORY_META } from "@/utils/category";
import { deleteTransaction } from "@/services/transactionService";
import BottomNav from "@/components/BottomNav";
import type { Month } from "@/types/month";
import type { Category, Transaction } from "@/types/transaction";
import BackButton from "@/components/BackButton";

type Filter = "all" | "income" | Category;

type TxWithId = Transaction & { _id: string };

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "income", label: "Ingresos" },
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
  const [transactions, setTransactions] = useState<TxWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);

  const isClosed = month?.closed === true;

  useEffect(() => {
    if (!user) return;

    const monthRef = doc(db, "users", user.uid, "months", viewedMonthId);
    const txQuery = query(
      collection(
        db,
        "users",
        user.uid,
        "months",
        viewedMonthId,
        "transactions",
      ),
      orderBy("transactionDate", "desc"),
      orderBy("serverDate", "desc"),
    );

    const unsubMonth = onSnapshot(
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

    const unsubTx = onSnapshot(txQuery, (snap) => {
      const txs = snap.docs.map((d) => ({
        ...(d.data() as Transaction),
        _id: d.id,
      }));
      setTransactions(txs);
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

  const filtered = transactions.filter((tx) => {
    if (filter === "all") return true;
    if (filter === "income") return tx.type === "income";
    return tx.type === "expense" && tx.category === filter;
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
    try {
      await deleteTransaction(user.uid, viewedMonthId, txId);
      setDeletingId(null);
      setOpenMenuId(null);
    } catch (err) {
      console.error("deleteTransaction falló:", err);
      setDeletingId(null);
    }
  }

  return (
    <div className="min-h-dvh bg-stone-50 pb-24">
      <header className="flex items-center gap-3 px-5 pt-8">
        <BackButton to="/dashboard" />
        <h1 className="text-xl font-semibold text-stone-900">Historial</h1>
      </header>

      <div className="flex items-center justify-center gap-2 px-5 pt-4">
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
          disabled={viewedMonthId >= CURRENT_MONTH_ID}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-stone-200 disabled:opacity-30"
        >
          ›
        </button>
      </div>

      {isClosed && (
        <p className="mt-3 px-5 text-center text-sm text-stone-500">
          Mes cerrado — solo lectura
        </p>
      )}

      <div className="mt-4 flex gap-2 overflow-x-auto px-5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              filter === f.key
                ? "border-stone-900 bg-stone-900 text-white"
                : "border-stone-300 text-stone-600"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

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
                  const isOpen = !isClosed;

                  if (isDeleting) {
                    return (
                      <div
                        key={tx._id}
                        className="rounded-2xl border border-amber-300 bg-amber-50 p-4"
                      >
                        <p className="text-sm text-amber-800">
                          Esta acción no se puede deshacer. ¿Borrar esta
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

      <BottomNav />
    </div>
  );
}

function TransactionRow({
  tx,
  isOpen,
  isMenuOpen,
  onToggleMenu,
  onEdit,
  onDelete,
  menuRef,
}: {
  tx: TxWithId;
  isOpen: boolean;
  isMenuOpen: boolean;
  onToggleMenu: () => void;
  onEdit: () => void;
  onDelete: () => void;
  menuRef: React.RefObject<HTMLDivElement | null>;
}) {
  const isIncome = tx.type === "income";
  const name = isIncome ? tx.source : tx.subcategory;
  const detail = isIncome
    ? tx.description
    : tx.description
      ? `${CATEGORY_META[tx.category].label} - ${tx.description}`
      : CATEGORY_META[tx.category].label;

  return (
    <div className="relative rounded-2xl border border-stone-200 bg-white p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-medium text-stone-900">{name}</p>
          {detail && <p className="mt-0.5 text-xs text-stone-400">{detail}</p>}
          {!isIncome && (
            <p className="mt-0.5 text-xs text-stone-400">{tx.paymentMethod}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-sm font-medium ${
              isIncome ? "text-emerald-600" : "text-red-600"
            }`}
          >
            {isIncome ? "+" : "-"}
            {formatCents(tx.amountCents)}
          </span>
          {isOpen && (
            <div className="relative" ref={isMenuOpen ? menuRef : undefined}>
              <button
                type="button"
                onClick={onToggleMenu}
                className="flex h-6 w-6 items-center justify-center text-stone-400"
              >
                ⋮
              </button>
              {isMenuOpen && (
                <div className="absolute right-0 top-8 z-10 w-36 rounded-xl border border-stone-200 bg-white py-1 shadow-lg">
                  <button
                    type="button"
                    onClick={onEdit}
                    className="w-full px-3 py-2 text-left text-sm text-stone-700 hover:bg-stone-50"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={onDelete}
                    className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-stone-50"
                  >
                    Borrar
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
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
    const d = tx.transactionDate;
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
