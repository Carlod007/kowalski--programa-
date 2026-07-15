import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/store/authStore";
import {
  updateExpense,
  updateIncome,
} from "@/services/transactionService";
import { formatDateLabel } from "@/utils/date";
import { formatCents } from "@/utils/currency";
import {
  CATEGORY_META,
  getCategoryStatus,
} from "@/utils/category";
import { calculateDistribution } from "@/utils/distribution";
import type { Month } from "@/types/month";
import type {
  ExpenseTransaction,
  IncomeTransaction,
} from "@/types/transaction";

type Tx = ExpenseTransaction | IncomeTransaction;

export default function EditTransaction() {
  const { monthId, txId } = useParams<{
    monthId: string;
    txId: string;
  }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const userProfile = useAuthStore((s) => s.userProfile);

  const [tx, setTx] = useState<Tx | null>(null);
  const [month, setMonth] = useState<Month | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [amountStr, setAmountStr] = useState("");
  const [source, setSource] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!user || !monthId || !txId) return;

    const uid = user.uid;
    const mid = monthId;
    const tid = txId;
    async function load() {
      try {
        const [txSnap, monthSnap] = await Promise.all([
          getDoc(doc(db, "users", uid, "months", mid, "transactions", tid)),
          getDoc(doc(db, "users", uid, "months", mid)),
        ]);

        if (!txSnap.exists() || !monthSnap.exists()) {
          setError("Transacción o mes no encontrado.");
          setLoading(false);
          return;
        }

        const transaction = txSnap.data() as Tx;
        const monthData = monthSnap.data() as Month;

        setTx(transaction);
        setMonth(monthData);
        setAmountStr((transaction.amountCents / 100).toString());

        if (transaction.type === "income") {
          setSource(transaction.source);
        } else {
          setSubcategory(transaction.subcategory);
          setPaymentMethod(transaction.paymentMethod);
        }

        if (transaction.description) {
          setDescription(transaction.description);
        }

        setLoading(false);
      } catch (err) {
        console.error("EditTransaction load error:", err);
        setError("Error al cargar los datos.");
        setLoading(false);
      }
    }

    load();
  }, [user, monthId, txId]);

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center text-stone-400">
        Cargando...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-stone-600">{error}</p>
        <Link to="/history" className="text-sm font-medium text-teal-700">
          Volver al historial
        </Link>
      </div>
    );
  }

  if (!tx || !month || !monthId) return null;

  if (month.closed) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-stone-600">Este mes ya está cerrado</p>
        <Link to="/history" className="text-sm font-medium text-teal-700">
          Volver al historial
        </Link>
      </div>
    );
  }

  const parsedAmount = parseFloat(amountStr);
  const newAmountCents =
    Number.isFinite(parsedAmount) && parsedAmount > 0
      ? Math.round(parsedAmount * 100)
      : 0;

  const isIncome = tx.type === "income";
  const isDisabled =
    saving ||
    newAmountCents === 0 ||
    (isIncome ? !source : !subcategory || !paymentMethod);

  function buildPreview() {
    if (!month || !tx || newAmountCents === 0) return null;

    if (isIncome) {
      const incomeTx = tx as IncomeTransaction;
      const newSplit = calculateDistribution(
        newAmountCents,
        month.distribution,
      );
      return (["necesidad", "ocio", "ahorro"] as const).map((cat) => {
        const actual = getCategoryStatus(
          month.capsCents[cat],
          month.spentCents[cat],
        ).disponible;
        const delta = newSplit[cat] - incomeTx.distribution[cat];
        const conCambio = actual + delta;
        return {
          label: CATEGORY_META[cat].label,
          actual,
          conCambio,
        };
      });
    }

    const expenseTx = tx as ExpenseTransaction;
    const cat = expenseTx.category;
    const actual = getCategoryStatus(
      month.capsCents[cat],
      month.spentCents[cat],
    ).disponible;
    const delta = newAmountCents - tx.amountCents;
    const conCambio = actual - delta;
    return [
      {
        label: CATEGORY_META[cat].label,
        actual,
        conCambio,
      },
    ];
  }

  const preview = buildPreview();

  async function handleSave() {
    if (!user || !monthId || !txId) return;
    setSaving(true);
    setError(null);

    try {
      if (isIncome) {
        await updateIncome(user.uid, monthId, txId, {
          amountCents: newAmountCents,
          source,
          description: description.trim() || undefined,
        });
      } else {
        await updateExpense(user.uid, monthId, txId, {
          amountCents: newAmountCents,
          subcategory,
          paymentMethod,
          description: description.trim() || undefined,
        });
      }
      navigate("/history");
    } catch (err) {
      console.error("updateTransaction falló:", err);
      setError("No se pudo guardar. Revisa tu conexión e intenta de nuevo.");
      setSaving(false);
    }
  }

  return (
    <div className="min-h-dvh bg-stone-50 px-5 pt-8 pb-10">
      <Link to="/history" className="text-sm text-stone-500">
        ← Cancelar
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-stone-900">
        {isIncome ? "Editar ingreso" : "Editar egreso"}
      </h1>

      <p className="mt-2 text-sm text-stone-500">
        Fecha: {formatDateLabel(tx.transactionDate)}
      </p>

      <div className="mt-6 flex flex-col gap-5">
        {isIncome ? (
          <IncomeFields
            source={source}
            onSourceChange={setSource}
            sources={userProfile?.sources ?? []}
          />
        ) : (
          <>
            <ExpenseCategoryLabel
              category={(tx as ExpenseTransaction).category}
            />
            <SubcategoryChips
              category={(tx as ExpenseTransaction).category}
              selected={subcategory}
              onSelect={setSubcategory}
              options={userProfile?.subcategories?.[(tx as ExpenseTransaction).category] ?? []}
            />
            <PaymentMethodChips
              selected={paymentMethod}
              onSelect={setPaymentMethod}
              options={userProfile?.paymentMethods ?? []}
            />
          </>
        )}

        <div className="flex flex-col gap-1">
          <label
            htmlFor="amount"
            className="text-sm font-medium text-stone-700"
          >
            Monto (S/)
          </label>
          <input
            id="amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-stone-900"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="description"
            className="text-sm font-medium text-stone-700"
          >
            Descripción <span className="text-stone-400">(opcional)</span>
          </label>
          <input
            id="description"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-stone-900"
          />
        </div>

        {preview && (
          <div className="rounded-xl bg-sky-50 p-3">
            <p className="text-sm font-medium text-teal-700">
              Impacto en disponibilidad
            </p>
            <div className="mt-2 flex flex-col gap-1">
              {preview.map((p) => (
                <div
                  key={p.label}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-stone-600">{p.label}</span>
                  <span className="font-medium">
                    <span className="text-stone-400">
                      {formatCents(p.actual)}
                    </span>
                    {" → "}
                    <span
                      className={
                        p.conCambio < 0 ? "text-red-600" : "text-emerald-600"
                      }
                    >
                      {formatCents(p.conCambio)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="button"
          onClick={handleSave}
          disabled={isDisabled}
          className="mt-2 rounded-xl bg-stone-900 py-3 font-medium text-white disabled:opacity-50"
        >
          {saving ? "Guardando..." : "Guardar cambios"}
        </button>
      </div>
    </div>
  );
}

function IncomeFields({
  source,
  onSourceChange,
  sources,
}: {
  source: string;
  onSourceChange: (v: string) => void;
  sources: { id: string; name: string }[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="source" className="text-sm font-medium text-stone-700">
        Fuente
      </label>
      <select
        id="source"
        value={source}
        onChange={(e) => onSourceChange(e.target.value)}
        className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-stone-900"
      >
        <option value="">Selecciona una fuente</option>
        {sources.map((s) => (
          <option key={s.id} value={s.name}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function ExpenseCategoryLabel({
  category,
}: {
  category: ExpenseTransaction["category"];
}) {
  const meta = CATEGORY_META[category];
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-stone-700">Categoría</span>
      <div
        className={`rounded-xl ${meta.bg} px-3 py-2 text-sm font-medium ${meta.text}`}
      >
        {meta.label}
      </div>
    </div>
  );
}

function SubcategoryChips({
  category,
  selected,
  onSelect,
  options,
}: {
  category: ExpenseTransaction["category"];
  selected: string;
  onSelect: (v: string) => void;
  options: string[];
}) {
  const meta = CATEGORY_META[category];
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-stone-700">Subcategoría</p>
      {options.length === 0 ? (
        <p className="text-sm text-stone-500">
          No hay subcategorías configuradas para {meta.label}.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((sub) => (
            <button
              key={sub}
              type="button"
              onClick={() => onSelect(sub)}
              className={`rounded-full border px-3 py-1.5 text-sm ${
                selected === sub
                  ? `${meta.selectedBorder} ${meta.bg} ${meta.text} border-2`
                  : "border-stone-300 text-stone-600"
              }`}
            >
              {sub}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PaymentMethodChips({
  selected,
  onSelect,
  options,
}: {
  selected: string;
  onSelect: (v: string) => void;
  options: { id: string; name: string; type: "cash" | "digital" }[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-stone-700">Método de pago</p>
      {options.length === 0 ? (
        <p className="text-sm text-stone-500">
          No hay métodos de pago configurados.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((pm) => (
            <button
              key={pm.id}
              type="button"
              onClick={() => onSelect(pm.name)}
              className={`rounded-full border px-3 py-1.5 text-sm ${
                selected === pm.name
                  ? "border-2 border-stone-900 bg-stone-900 text-white"
                  : "border-stone-300 text-stone-600"
              }`}
            >
              {pm.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
