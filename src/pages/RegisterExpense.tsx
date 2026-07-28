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
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useNavigate } from "react-router-dom";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/store/authStore";
import { checkAndCloseMonth } from "@/services/monthService";
import { purchaseGoalExpense } from "@/services/transactionService";
import { getMonthId, toDateInputValue, formatDateLabel } from "@/utils/date";
import {
  CAP_CATEGORY_ORDER,
  CATEGORY_META,
  getCategoryStatus,
} from "@/utils/category";
import { formatCents } from "@/utils/currency";
import CategorySelectCard from "@/components/CategorySelectCard";
import SavingsSelectCard from "@/components/SavingsSelectCard";
import type { Month, MonthCaps } from "@/types/month";
import type { ExpenseTransaction } from "@/types/transaction";
import { ArrowLeftIcon } from "@/components/BackButton";

type Step = "category" | "detail" | "goal";

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
  const userProfile = useAuthStore((s) => s.userProfile);
  const [month, setMonth] = useState<Month | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>("category");
  const [category, setCategory] = useState<keyof MonthCaps | null>(null);

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

  if (step === "goal") {
    return <GoalPurchaseStep onBack={() => setStep("category")} />;
  }

  return (
    <div className="min-h-dvh bg-stone-50 px-5 pt-8 pb-10">
      <Link
        to="/dashboard"
        className="flex items-center gap-1 text-sm text-stone-500"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Cancelar
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-stone-900">
        Nuevo egreso
      </h1>
      <p className="mt-1 text-sm text-stone-500">
        ¿En qué categoría está este gasto?
      </p>

      <div className="mt-6 flex flex-col gap-3">
        {CAP_CATEGORY_ORDER.map((cat) => (
          <CategorySelectCard
            key={cat}
            category={cat}
            capCents={month?.capsCents[cat] ?? 0}
            spentCents={month?.spentCents[cat] ?? 0}
            selected={category === cat}
            onSelect={(selectedCat) => {
              if (selectedCat === "necesidad" || selectedCat === "ocio") {
                setCategory(selectedCat);
                setStep("detail");
              }
            }}
          />
        ))}
        <SavingsSelectCard
          savingsTotalCents={userProfile?.savingsTotalCents ?? 0}
          contributedThisMonth={month?.ahorroContributedCents ?? 0}
          percentage={month?.distribution.ahorro ?? 0}
          selected={false}
          onSelect={() => setStep("goal")}
        />
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
  category: keyof MonthCaps;
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

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<DetailFormValues>({
    resolver: zodResolver(detailSchema),
    defaultValues: { date: today, amount: "", description: "" },
  });

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
          className="flex items-center gap-1 text-sm text-stone-500"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Volver a categorías
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
          <label className="text-sm font-medium text-stone-700">Fecha</label>
          <div className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-stone-900">
            {formatDateLabel(today)}
          </div>
          <input type="hidden" value={today} {...register("date")} />
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

function GoalPurchaseStep({ onBack }: { onBack: () => void }) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const userProfile = useAuthStore((s) => s.userProfile);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [pickError, setPickError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const today = toDateInputValue();
  const goals = userProfile?.savingsGoals ?? [];
  const paymentMethods = userProfile?.paymentMethods ?? [];
  const savingsTotalCents = userProfile?.savingsTotalCents ?? 0;
  const meta = CATEGORY_META.ahorro;

  const selectedGoal = goals.find((g) => g.id === selectedGoalId) ?? null;

  async function handleSubmit() {
    if (!user || !selectedGoal || !paymentMethod) {
      setPickError("Selecciona una meta y un método de pago");
      return;
    }
    if (savingsTotalCents < selectedGoal.targetCents) {
      setPickError("Todavía no juntaste lo suficiente para esta meta");
      return;
    }
    setPickError(null);
    setSaving(true);
    setSubmitError(null);

    try {
      await purchaseGoalExpense(user.uid, getMonthId(), {
        goal: selectedGoal,
        paymentMethod,
        description: description.trim() || undefined,
        date: today,
      });
      navigate("/dashboard");
    } catch (err) {
      console.error("Error al comprar meta:", err);
      setSubmitError(
        "No se pudo guardar. Revisa tu conexión e intenta de nuevo.",
      );
      setSaving(false);
    }
  }

  return (
    <div className="min-h-dvh bg-stone-50 px-5 pt-8 pb-10">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-stone-500"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Volver a categorías
        </button>
        <span className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-medium text-teal-700">
          {formatCents(savingsTotalCents)} disponible
        </span>
      </div>

      <h1 className={`mt-4 text-2xl font-semibold ${meta.text}`}>Ahorro</h1>

      <div className="mt-6 flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-stone-700">Fecha</label>
          <div className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-stone-900">
            {formatDateLabel(today)}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-stone-700">Meta</p>
          {goals.length === 0 ? (
            <p className="text-sm text-stone-500">
              Todavía no configuraste metas de ahorro. Podés crearlas desde
              Ajustes.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {goals.map((goal) => {
                const reachable = savingsTotalCents >= goal.targetCents;
                return (
                  <button
                    key={goal.id}
                    type="button"
                    disabled={!reachable}
                    onClick={() => setSelectedGoalId(goal.id)}
                    aria-pressed={selectedGoalId === goal.id}
                    className={`rounded-full border px-3 py-1.5 text-sm ${
                      !reachable
                        ? "border-stone-200 text-stone-300"
                        : selectedGoalId === goal.id
                          ? `${meta.selectedBorder} ${meta.bg} ${meta.text} border-2`
                          : "border-stone-300 text-stone-600"
                    }`}
                  >
                    {goal.name} · {formatCents(goal.targetCents)}
                  </button>
                );
              })}
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
            htmlFor="goal-description"
            className="text-sm font-medium text-stone-700"
          >
            Descripción <span className="text-stone-400">(opcional)</span>
          </label>
          <input
            id="goal-description"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-stone-900"
          />
        </div>

        {pickError && <p className="text-sm text-red-600">{pickError}</p>}
        {submitError && <p className="text-sm text-red-600">{submitError}</p>}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving}
          className="mt-2 rounded-xl bg-stone-900 py-3 font-medium text-white disabled:opacity-50"
        >
          {saving ? "Guardando..." : "Confirmar compra"}
        </button>
      </div>
    </div>
  );
}
