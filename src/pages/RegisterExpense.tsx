// src/pages/RegisterExpense.tsx
import { useEffect, useState } from "react";
import {
  collection,
  doc,
  increment,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  type UpdateData,
  type WithFieldValue,
} from "firebase/firestore";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useNavigate } from "react-router-dom";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/store/authStore";
import { checkAndCloseMonth } from "@/services/monthService";
import { getMonthId, toDateInputValue, formatDateLabel } from "@/utils/date";
import {
  CATEGORY_ORDER,
  CATEGORY_META,
  getCategoryStatus,
} from "@/utils/category";
import { formatCents } from "@/utils/currency";
import CategorySelectCard from "@/components/CategorySelectCard";
import type { Month } from "@/types/month";
import type { Category, ExpenseTransaction } from "@/types/transaction";

type Step = "category" | "detail";

const detailSchema = z.object({
  date: z.string().min(1, "Selecciona una fecha"),
  amount: z
    .string()
    .min(1, "Ingresa un monto")
    .refine((v) => Number.isFinite(parseFloat(v)) && parseFloat(v) > 0, {
      message: "El monto debe ser mayor a 0",
    }),
  description: z.string().optional(),
});

type DetailFormValues = z.infer<typeof detailSchema>;

export default function RegisterExpense() {
  const user = useAuthStore((s) => s.user);
  const [month, setMonth] = useState<Month | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>("category");
  const [category, setCategory] = useState<Category | null>(null);

  useEffect(() => {
    if (!user) return;

    checkAndCloseMonth(user.uid).catch((err) => {
      console.error("checkAndCloseMonth falló:", err);
    });

    const monthRef = doc(db, "users", user.uid, "months", getMonthId());
    const unsubscribe = onSnapshot(
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

    return () => unsubscribe();
  }, [user]);

  function handleSelectCategory(cat: Category) {
    setCategory(cat);
    setStep("detail");
  }

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center text-stone-400">
        Cargando mes...
      </div>
    );
  }

  if (step === "detail" && category) {
    return (
      <ExpenseDetailStep
        category={category}
        capCents={month?.capsCents[category] ?? 0}
        spentCents={month?.spentCents[category] ?? 0}
        onBack={() => setStep("category")}
      />
    );
  }

  return (
    <div className="min-h-dvh bg-stone-50 px-5 pt-8 pb-10">
      <Link to="/dashboard" className="text-sm text-stone-500">
        ← Cancelar
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-stone-900">
        Nuevo egreso
      </h1>
      <p className="mt-1 text-sm text-stone-500">
        ¿En qué categoría está este gasto?
      </p>

      <div className="mt-6 flex flex-col gap-3">
        {CATEGORY_ORDER.map((cat) => (
          <CategorySelectCard
            key={cat}
            category={cat}
            capCents={month?.capsCents[cat] ?? 0}
            spentCents={month?.spentCents[cat] ?? 0}
            selected={category === cat}
            onSelect={handleSelectCategory}
          />
        ))}
      </div>
    </div>
  );
}

function ExpenseDetailStep({
  category,
  capCents,
  spentCents,
  onBack,
}: {
  category: Category;
  capCents: number;
  spentCents: number;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const userProfile = useAuthStore((s) => s.userProfile);
  const [subcategory, setSubcategory] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showEmptyCapWarning, setShowEmptyCapWarning] = useState(false);
  const [pendingValues, setPendingValues] = useState<DetailFormValues | null>(
    null,
  );

  const today = toDateInputValue();
  const minDate = `${getMonthId()}-01`;

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<DetailFormValues>({
    resolver: zodResolver(detailSchema),
    defaultValues: { date: today, amount: "", description: "" },
  });

  const watchedDate = useWatch({ control, name: "date" });
  const subcategories = userProfile?.subcategories[category] ?? [];
  const paymentMethods = userProfile?.paymentMethods ?? [];
  const meta = CATEGORY_META[category];
  const status = getCategoryStatus(capCents, spentCents);

  async function saveExpense(values: DetailFormValues) {
    if (!user || !subcategory || !paymentMethod) return;

    setSaving(true);
    setSubmitError(null);

    const amountCents = Math.round(parseFloat(values.amount) * 100);
    const monthId = getMonthId();
    const description = values.description?.trim();

    const batch = writeBatch(db);

    const txRef = doc(
      collection(db, "users", user.uid, "months", monthId, "transactions"),
    );
    const tx: WithFieldValue<ExpenseTransaction> = {
      type: "expense",
      category,
      subcategory,
      paymentMethod,
      amountCents,
      transactionDate: values.date,
      serverDate: serverTimestamp(),
      localDate: new Date().toISOString(),
      ...(description ? { description } : {}),
    };
    batch.set(txRef, tx);

    const monthRef = doc(db, "users", user.uid, "months", monthId);
    const monthUpdate: UpdateData<Month> = {
      [`spentCents.${category}`]: increment(amountCents),
    };
    batch.update(monthRef, monthUpdate);

    try {
      await batch.commit();
      navigate("/dashboard");
    } catch (err) {
      console.error("Error al registrar egreso:", err);
      setSubmitError(
        "No se pudo guardar. Revisa tu conexión e intenta de nuevo.",
      );
      setSaving(false);
    }
  }

  async function onSubmit(values: DetailFormValues) {
    if (!subcategory || !paymentMethod) {
      setPickError("Selecciona subcategoría y método de pago");
      return;
    }
    setPickError(null);

    if (status.isEmpty) {
      setPendingValues(values);
      setShowEmptyCapWarning(true);
      return;
    }

    await saveExpense(values);
  }

  function handleConfirmEmptyCap() {
    setShowEmptyCapWarning(false);
    if (pendingValues) {
      saveExpense(pendingValues);
    }
  }

  function handleCancelEmptyCapWarning() {
    setShowEmptyCapWarning(false);
    setPendingValues(null);
  }

  return (
    <div className="min-h-dvh bg-stone-50 px-5 pt-8 pb-10">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-stone-500"
        >
          ← Volver a categorías
        </button>
        {!status.isEmpty && (
          <span
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              status.isLow
                ? "border-red-200 bg-red-50 text-red-600"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
            }`}
          >
            {formatCents(status.disponible)} disponible
          </span>
        )}
      </div>

      <h1 className={`mt-4 text-2xl font-semibold ${meta.text}`}>
        {meta.label}
      </h1>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="mt-6 flex flex-col gap-5"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="date" className="text-sm font-medium text-stone-700">
            Fecha
          </label>
          <div className="relative">
            <div className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-stone-900">
              {formatDateLabel(watchedDate || today)}
            </div>
            <input
              id="date"
              type="date"
              min={minDate}
              max={today}
              {...register("date")}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </div>
          {errors.date && (
            <p className="text-xs text-red-600">{errors.date.message}</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-stone-700">Subcategoría</p>
          {subcategories.length === 0 ? (
            <p className="text-sm text-stone-500">
              No hay subcategorías configuradas para {meta.label}.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {subcategories.map((sub) => (
                <button
                  key={sub}
                  type="button"
                  onClick={() => setSubcategory(sub)}
                  aria-pressed={subcategory === sub}
                  className={`rounded-full border px-3 py-1.5 text-sm ${
                    subcategory === sub
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

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-stone-700">Método de pago</p>
          {paymentMethods.length === 0 ? (
            <p className="text-sm text-stone-500">
              No hay métodos de pago configurados.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {paymentMethods.map((pm) => (
                <button
                  key={pm.id}
                  type="button"
                  onClick={() => setPaymentMethod(pm.name)}
                  aria-pressed={paymentMethod === pm.name}
                  className={`rounded-full border px-3 py-1.5 text-sm ${
                    paymentMethod === pm.name
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
            placeholder="0.00"
            {...register("amount")}
            className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-stone-900"
          />
          {errors.amount && (
            <p className="text-xs text-red-600">{errors.amount.message}</p>
          )}
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
            {...register("description")}
            className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-stone-900"
          />
        </div>

        {pickError && <p className="text-sm text-red-600">{pickError}</p>}

        {showEmptyCapWarning && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
            <p className="text-sm text-amber-800">
              Todavía no registraste ingresos este mes — este gasto va a
              aparecer como deuda desde el inicio.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={handleCancelEmptyCapWarning}
                className="flex-1 rounded-lg border border-amber-300 py-2 text-sm font-medium text-amber-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmEmptyCap}
                className="flex-1 rounded-lg bg-amber-600 py-2 text-sm font-medium text-white"
              >
                Registrar igual
              </button>
            </div>
          </div>
        )}

        {submitError && <p className="text-sm text-red-600">{submitError}</p>}

        <button
          type="submit"
          disabled={isSubmitting || saving}
          className="mt-2 rounded-xl bg-stone-900 py-3 font-medium text-white disabled:opacity-50"
        >
          {isSubmitting || saving ? "Guardando..." : "Guardar egreso"}
        </button>
      </form>
    </div>
  );
}
