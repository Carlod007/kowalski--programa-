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
import {
  purchaseGoalExpense,
  withdrawFromFund,
} from "@/services/transactionService";
import { getMonthId, toDateInputValue, formatDateLabel } from "@/utils/date";
import {
  CAP_CATEGORY_ORDER,
  CATEGORY_META,
  getCategoryStatus,
} from "@/utils/category";
import { formatCents } from "@/utils/currency";
import CategorySelectCard from "@/components/CategorySelectCard";
import SavingsSelectCard from "@/components/SavingsSelectCard";
import CategoryIcon from "@/components/CategoryIcon";
import {
  getAssignableCents,
  getGoalKind,
  getGoalProgress,
  wasPurchased,
} from "@/utils/savings";
import type { Month, MonthCaps } from "@/types/month";
import type { SavingsGoal } from "@/types/user";
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
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<DetailFormValues>({
    resolver: zodResolver(detailSchema),
    defaultValues: { date: today, amount: "", description: "" },
  });

  const subcategories = userProfile?.subcategories[category] ?? [];
  const paymentMethods = userProfile?.paymentMethods ?? [];
  const essentialNeeds = userProfile?.essentialNeeds ?? [];
  const meta = CATEGORY_META[category];
  const status = getCategoryStatus(capCents, spentCents);

  const essentialNeedNames = new Set(essentialNeeds.map((n) => n.name));
  const fixedSubcategories = subcategories.filter((s) =>
    essentialNeedNames.has(s),
  );
  const variableSubcategories = subcategories.filter(
    (s) => !essentialNeedNames.has(s),
  );

  function renderSubcategoryChips(items: string[]) {
    return (
      <div className="flex flex-wrap gap-2">
        {items.map((sub) => (
          <button
            key={sub}
            type="button"
            onClick={() => handleSelectSubcategory(sub)}
            aria-pressed={subcategory === sub}
            className={`rounded-full border-2 px-3 py-1.5 text-sm ${
              subcategory === sub
                ? `${meta.selectedBorder} ${meta.bg} ${meta.text}`
                : "border-stone-300 text-stone-600"
            }`}
          >
            {sub}
          </button>
        ))}
      </div>
    );
  }

  function handleSelectSubcategory(sub: string) {
    if (subcategory === sub) {
      setSubcategory(null);
      if (category === "necesidad" && essentialNeeds.some((n) => n.name === sub)) {
        setValue("amount", "");
      }
      return;
    }

    setSubcategory(sub);
    if (category === "necesidad") {
      const matched = essentialNeeds.find((n) => n.name === sub);
      setValue(
        "amount",
        matched ? (matched.monthlyAmountCents / 100).toString() : "",
      );
    }
  }

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
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
              status.isLow
                ? "border-red-200 bg-red-50 text-red-600"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
            }`}
          >
            <WalletIcon />
            {formatCents(status.disponible)} disponible
          </span>
        )}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <CategoryIcon category={category} />
        <div>
          <h1 className={`text-2xl font-semibold ${meta.text}`}>
            {meta.label}
          </h1>
          <p className="text-sm text-stone-500">Registra tu egreso</p>
        </div>
      </div>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="mt-6 flex flex-col gap-5"
      >
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-stone-700">Fecha</label>
          <div className="flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-3 py-2 text-stone-900">
            <CalendarIcon />
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
          ) : category === "necesidad" ? (
            <div className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-4">
              {fixedSubcategories.length > 0 && (
                <SubcategoryGroup
                  title="Gastos fijos"
                  items={fixedSubcategories}
                  selected={subcategory}
                  meta={meta}
                  onSelect={handleSelectSubcategory}
                />
              )}
              {fixedSubcategories.length > 0 &&
                variableSubcategories.length > 0 && (
                  <div className="border-t border-stone-100" />
                )}
              {variableSubcategories.length > 0 && (
                <SubcategoryGroup
                  title="Gastos variables"
                  items={variableSubcategories}
                  selected={subcategory}
                  meta={meta}
                  onSelect={handleSelectSubcategory}
                />
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-stone-200 bg-white p-4">
              {renderSubcategoryChips(subcategories)}
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
            <div className="flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-3 py-2 text-stone-900">
              <WalletIcon className="h-4 w-4 text-stone-400" />
              <select
                value={paymentMethod ?? ""}
                onChange={(e) => setPaymentMethod(e.target.value || null)}
                className="w-full flex-1 appearance-none bg-transparent text-sm outline-none"
              >
                <option value="" disabled>
                  Selecciona un método
                </option>
                {paymentMethods.map((pm) => (
                  <option key={pm.id} value={pm.name}>
                    {pm.name}
                  </option>
                ))}
              </select>
              <ChevronDownIcon className="h-4 w-4 text-stone-400" />
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
              Todavía no registraste ingresos este mes - este gasto va a
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

function WalletIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <circle cx="17" cy="14.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ChevronDownIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 text-stone-400"
    >
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
      <path d="M8 3v4M16 3v4" />
    </svg>
  );
}

function GoalChipGroup({
  title,
  goals,
  selectedGoalId,
  assignableCents,
  meta,
  onSelect,
}: {
  title: string;
  goals: SavingsGoal[];
  selectedGoalId: string | null;
  assignableCents: number;
  meta: { selectedBorder: string; bg: string; text: string };
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium text-stone-400">{title}</p>
      <div className="flex flex-wrap gap-2">
        {goals.map((goal) => {
          const progress = getGoalProgress(goal);
          // Un fondo se puede usar apenas tenga algo asignado. Una compra, si
          // ya está completa o si el ahorro sin asignar cubre lo que falta.
          const selectable =
            progress.kind === "fondo"
              ? progress.allocatedCents > 0
              : progress.isComplete ||
                progress.missingCents <= assignableCents;
          return (
            <button
              key={goal.id}
              type="button"
              disabled={!selectable}
              onClick={() => onSelect(goal.id)}
              aria-pressed={selectedGoalId === goal.id}
              className={`rounded-full border-2 px-3 py-1.5 text-sm ${
                !selectable
                  ? "border-stone-200 text-stone-300"
                  : selectedGoalId === goal.id
                    ? `${meta.selectedBorder} ${meta.bg} ${meta.text}`
                    : "border-stone-300 text-stone-600"
              }`}
            >
              {/* El aviso va en el chip y no al seleccionarlo: una meta ya
                  comprada suele quedar sin plata asignada, y así no se podría
                  elegir para verlo. */}
              {wasPurchased(goal) && (
                <span className="mr-1 text-emerald-600">✓</span>
              )}
              {goal.name} ·{" "}
              {progress.kind === "fondo"
                ? formatCents(progress.allocatedCents)
                : formatCents(goal.targetCents)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const SUBCATEGORY_PREVIEW_COUNT = 3;

function SubcategoryGroup({
  title,
  items,
  selected,
  meta,
  onSelect,
}: {
  title: string;
  items: string[];
  selected: string | null;
  meta: { selectedBorder: string; bg: string; text: string };
  onSelect: (sub: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasMore = items.length > SUBCATEGORY_PREVIEW_COUNT;
  const visible = expanded ? items : items.slice(0, SUBCATEGORY_PREVIEW_COUNT);

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium text-stone-400">{title}</p>
      <div className="grid grid-cols-3 gap-2">
        {visible.map((sub) => (
          <button
            key={sub}
            type="button"
            onClick={() => onSelect(sub)}
            aria-pressed={selected === sub}
            className={`rounded-full border-2 px-2 py-1.5 text-center text-sm ${
              selected === sub
                ? `${meta.selectedBorder} ${meta.bg} ${meta.text}`
                : "border-stone-300 text-stone-600"
            }`}
          >
            {sub}
          </button>
        ))}
      </div>
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 self-start text-xs font-medium text-stone-500"
        >
          {expanded ? "Ver menos" : "Ver más"}
          <ChevronDownIcon
            className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </button>
      )}
    </div>
  );
}

function GoalPurchaseStep({ onBack }: { onBack: () => void }) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const userProfile = useAuthStore((s) => s.userProfile);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [amountInput, setAmountInput] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [pickError, setPickError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const today = toDateInputValue();
  const allGoals = userProfile?.savingsGoals ?? [];
  const fundGoals = allGoals.filter((g) => getGoalKind(g) === "fondo");
  const purchaseGoals = allGoals.filter((g) => getGoalKind(g) === "compra");
  const paymentMethods = userProfile?.paymentMethods ?? [];
  const savingsTotalCents = userProfile?.savingsTotalCents ?? 0;
  const assignableCents = getAssignableCents(savingsTotalCents, allGoals);
  const meta = CATEGORY_META.ahorro;

  const selectedGoal = allGoals.find((g) => g.id === selectedGoalId) ?? null;
  const selectedProgress = selectedGoal ? getGoalProgress(selectedGoal) : null;
  const isFund = selectedProgress?.kind === "fondo";

  // El atajo (solo para compras): la meta no llegó, pero el ahorro sin asignar
  // cubre lo que falta.
  const needsAutoAssign =
    selectedProgress !== null && !isFund && !selectedProgress.isComplete;
  const canAutoAssign =
    needsAutoAssign && selectedProgress.missingCents <= assignableCents;

  // Un fondo se retira por el monto que haga falta; una compra siempre va por
  // su objetivo completo.
  const parsedAmount = parseFloat(amountInput);
  const withdrawCents =
    Number.isFinite(parsedAmount) && parsedAmount > 0
      ? Math.round(parsedAmount * 100)
      : 0;
  const maxWithdrawCents = selectedProgress?.allocatedCents ?? 0;
  const exceedsFund = isFund && withdrawCents > maxWithdrawCents;

  async function handleSubmit() {
    if (!user || !selectedGoal || !selectedProgress || !paymentMethod) {
      setPickError("Selecciona una meta y un método de pago");
      return;
    }
    if (isFund) {
      if (withdrawCents <= 0) {
        setPickError("Ingresa cuánto vas a retirar");
        return;
      }
      if (exceedsFund) {
        setPickError("El monto supera lo asignado a este fondo");
        return;
      }
    } else if (needsAutoAssign && !canAutoAssign) {
      setPickError("Todavía no juntaste lo suficiente para esta meta");
      return;
    }
    setPickError(null);
    setSaving(true);
    setSubmitError(null);

    try {
      if (isFund) {
        await withdrawFromFund(user.uid, getMonthId(), {
          goalId: selectedGoal.id,
          amountCents: withdrawCents,
          paymentMethod,
          description: description.trim() || undefined,
          date: today,
        });
      } else {
        await purchaseGoalExpense(user.uid, getMonthId(), {
          goalId: selectedGoal.id,
          paymentMethod,
          description: description.trim() || undefined,
          date: today,
          allowAutoAssign: needsAutoAssign,
        });
      }
      navigate("/dashboard");
    } catch (err) {
      console.error("Error al usar el ahorro:", err);
      setSubmitError(
        err instanceof Error
          ? err.message
          : "No se pudo guardar. Revisa tu conexión e intenta de nuevo.",
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
        <span className="flex items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-medium text-teal-700">
          <WalletIcon />
          {formatCents(savingsTotalCents)} ahorrado
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
          {allGoals.length === 0 ? (
            <p className="text-sm text-stone-500">
              Todavía no configuraste metas de ahorro. Puedes crearlas desde
              Ajustes.
            </p>
          ) : (
            <div className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-4">
              {fundGoals.length > 0 && (
                <GoalChipGroup
                  title="Fondos (uso libre)"
                  goals={fundGoals}
                  selectedGoalId={selectedGoalId}
                  assignableCents={assignableCents}
                  meta={meta}
                  onSelect={(id) => {
                    setSelectedGoalId(id);
                    setAmountInput("");
                  }}
                />
              )}
              {fundGoals.length > 0 && purchaseGoals.length > 0 && (
                <div className="border-t border-stone-100" />
              )}
              {purchaseGoals.some((g) => wasPurchased(g)) && (
                <p className="text-xs text-emerald-700">
                  ✓ = ya adquirida. Puedes volver a juntar y comprarla de nuevo.
                </p>
              )}
              {purchaseGoals.length > 0 && (
                <GoalChipGroup
                  title="Metas de compra"
                  goals={purchaseGoals}
                  selectedGoalId={selectedGoalId}
                  assignableCents={assignableCents}
                  meta={meta}
                  onSelect={(id) => {
                    setSelectedGoalId(id);
                    setAmountInput("");
                  }}
                />
              )}
            </div>
          )}

          {selectedProgress && needsAutoAssign && canAutoAssign && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
              <p className="text-xs text-amber-800">
                A esta meta le faltan{" "}
                {formatCents(selectedProgress.missingCents)} asignados. Al
                confirmar se asignan desde tu ahorro sin asignar (
                {formatCents(assignableCents)}) y se compra en un solo paso.
              </p>
            </div>
          )}

          {selectedProgress && !needsAutoAssign && (
            <p className="text-xs text-stone-400">
              Asignado: {formatCents(selectedProgress.allocatedCents)} de{" "}
              {formatCents(selectedProgress.targetCents)}
            </p>
          )}

          {selectedGoal && wasPurchased(selectedGoal) && (
            <p className="text-xs text-emerald-700">
              Ya adquirida
              {selectedGoal.lastPurchasedAt
                ? ` el ${formatDateLabel(selectedGoal.lastPurchasedAt)}`
                : ""}
              . Puedes comprarla de nuevo si lo necesitas.
            </p>
          )}
        </div>

        {isFund && selectedProgress && (
          <div className="flex flex-col gap-1">
            <label
              htmlFor="withdraw"
              className="text-sm font-medium text-stone-700"
            >
              Cuánto vas a retirar (S/)
            </label>
            <input
              id="withdraw"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              type="number"
              inputMode="decimal"
              step="0.01"
              placeholder="0.00"
              className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-stone-900"
            />
            <p className="text-xs text-stone-400">
              Disponible en este fondo: {formatCents(maxWithdrawCents)}
            </p>
            {exceedsFund && (
              <p className="text-xs text-red-600">
                Supera lo asignado a este fondo
              </p>
            )}
          </div>
        )}

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
          disabled={saving || exceedsFund}
          className="mt-2 rounded-xl bg-stone-900 py-3 font-medium text-white disabled:opacity-50"
        >
          {saving
            ? "Guardando..."
            : isFund
              ? "Confirmar retiro"
              : "Confirmar compra"}
        </button>
      </div>
    </div>
  );
}
