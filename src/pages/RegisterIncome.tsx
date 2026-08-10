import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate, Link } from "react-router-dom";
import {
  collection,
  doc,
  increment,
  serverTimestamp,
  writeBatch,
  type UpdateData,
  type WithFieldValue,
} from "firebase/firestore";
import { Calendar, User, ChevronDown, FileText, Save } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/store/authStore";
import { getMonthId, toDateInputValue, formatDateLabel } from "@/utils/date";
import { calculateDistribution } from "@/utils/distribution";
import { doc as firestoreDoc, getDoc } from "firebase/firestore";
import { formatCents } from "@/utils/currency";
import type { IncomeTransaction, Distribution } from "@/types/transaction";
import type { Month } from "@/types/month";
import { ArrowLeftIcon } from "@/components/BackButton";

/** Etiqueta fija de los aportes directos: no ensucia las fuentes del usuario. */
const DIRECT_SAVINGS_LABEL = "Aporte directo";

const incomeSchema = z.object({
  // La fuente no se valida acá porque un aporte directo no lleva ninguna.
  // La exigencia real está en onSubmit, según el modo.
  source: z.string(),
  date: z.string().min(1, "Selecciona una fecha"),
  amount: z
    .string()
    .min(1, "Ingresa un monto")
    .refine((v) => Number.isFinite(parseFloat(v)) && parseFloat(v) > 0, {
      message: "El monto debe ser mayor a 0",
    }),
  description: z.string().optional(),
});

type IncomeFormValues = z.infer<typeof incomeSchema>;

export default function RegisterIncome() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const userProfile = useAuthStore((s) => s.userProfile);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isDirectSavings, setIsDirectSavings] = useState(false);
  const [monthDistribution, setMonthDistribution] =
    useState<Distribution | null>(null);

  const today = toDateInputValue();

  useEffect(() => {
    if (!user) return;
    const monthId = getMonthId();
    getDoc(firestoreDoc(db, "users", user.uid, "months", monthId))
      .then((snap) => {
        if (snap.exists()) {
          setMonthDistribution((snap.data() as Month).distribution);
        }
      })
      .catch((err) => {
        console.error("Error al cargar distribución del mes:", err);
      });
  }, [user]);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<IncomeFormValues>({
    resolver: zodResolver(incomeSchema),
    defaultValues: { source: "", date: today, amount: "", description: "" },
  });

  const sources = userProfile?.sources ?? [];
  const fixedIncomes = userProfile?.fixedIncomes ?? [];
  const watchedAmount = useWatch({ control, name: "amount" });
  const watchedSource = useWatch({ control, name: "source" });

  const [overriddenFor, setOverriddenFor] = useState<string | null>(null);
  const matchedFixedIncome =
    fixedIncomes.find((f) => f.id === watchedSource) ?? null;
  const isLocked = !!matchedFixedIncome && overriddenFor !== watchedSource;

  function handleSourceChange(newSourceId: string) {
    const fixed = fixedIncomes.find((f) => f.id === newSourceId);
    setOverriddenFor(null);
    setValue(
      "amount",
      fixed ? (fixed.monthlyAmountCents / 100).toString() : "",
    );
  }

  const parsedAmount = parseFloat(watchedAmount);
  const previewCents =
    Number.isFinite(parsedAmount) && parsedAmount > 0
      ? Math.round(parsedAmount * 100)
      : 0;
  const preview =
    !isDirectSavings && previewCents > 0 && monthDistribution
      ? calculateDistribution(previewCents, monthDistribution)
      : null;

  async function onSubmit(values: IncomeFormValues) {
    if (!user || !userProfile) return;
    setSubmitError(null);

    if (!monthDistribution) {
      setSubmitError("No se pudo cargar el mes. Intenta de nuevo.");
      return;
    }
    if (!isDirectSavings && !values.source) {
      setSubmitError("Selecciona una fuente");
      return;
    }

    const amountCents = Math.round(parseFloat(values.amount) * 100);
    const monthId = getMonthId();
    const description = values.description?.trim();
    const selectedSource = sources.find((s) => s.id === values.source);

    const batch = writeBatch(db);

    const txRef = doc(
      collection(db, "users", user.uid, "months", monthId, "transactions"),
    );
    const monthRef = doc(db, "users", user.uid, "months", monthId);
    const userRef = doc(db, "users", user.uid);

    if (isDirectSavings) {
      // Va entero al ahorro: no toca los topes ni totalIncomeCents, para no
      // alterar los porcentajes del mes con plata que nunca se repartió.
      const tx: WithFieldValue<IncomeTransaction> = {
        type: "income",
        source: DIRECT_SAVINGS_LABEL,
        transactionDate: values.date,
        amountCents,
        distribution: { necesidad: 0, ocio: 0, ahorro: amountCents },
        isDirectSavings: true,
        serverDate: serverTimestamp(),
        localDate: new Date().toISOString(),
        ...(description ? { description } : {}),
      };
      batch.set(txRef, tx);

      const monthUpdate: UpdateData<Month> = {
        directSavingsCents: increment(amountCents),
        incomeCount: increment(1),
        ahorroContributedCents: increment(amountCents),
      };
      batch.update(monthRef, monthUpdate);
      batch.update(userRef, { savingsTotalCents: increment(amountCents) });
    } else {
      const distribution = calculateDistribution(
        amountCents,
        monthDistribution,
      );
      const tx: WithFieldValue<IncomeTransaction> = {
        type: "income",
        source: selectedSource?.name ?? "",
        sourceId: values.source,
        transactionDate: values.date,
        amountCents,
        distribution,
        serverDate: serverTimestamp(),
        localDate: new Date().toISOString(),
        ...(description ? { description } : {}),
      };
      batch.set(txRef, tx);

      const monthUpdate: UpdateData<Month> = {
        totalIncomeCents: increment(amountCents),
        incomeCount: increment(1),
        "capsCents.necesidad": increment(distribution.necesidad),
        "capsCents.ocio": increment(distribution.ocio),
        ahorroContributedCents: increment(distribution.ahorro),
      };
      batch.update(monthRef, monthUpdate);
      batch.update(userRef, {
        savingsTotalCents: increment(distribution.ahorro),
      });
    }

    try {
      await batch.commit();
      navigate("/dashboard");
    } catch (err) {
      console.error("Error al registrar ingreso:", err);
      setSubmitError(
        "No se pudo guardar. Revisa tu conexión e intenta de nuevo.",
      );
    }
  }

  // Sin fuentes configuradas solo se bloquea el ingreso repartido: un aporte
  // directo no necesita ninguna, y ese es justamente su caso de uso.
  if (sources.length === 0 && !isDirectSavings) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-stone-600">
          Todavía no tienes fuentes de ingreso configuradas.
        </p>
        <button
          type="button"
          onClick={() => setIsDirectSavings(true)}
          className="text-sm font-medium text-teal-700"
        >
          Registrar un aporte directo a Ahorro
        </button>
        <Link to="/dashboard" className="text-sm text-stone-500">
          Volver al inicio
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-stone-50 px-5 pt-8 pb-10">
      <Link
        to="/dashboard"
        className="flex items-center gap-1 text-sm text-emerald-600"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Cancelar
      </Link>

      <h1 className="mt-4 text-3xl font-bold text-stone-900">
        Registrar ingreso
      </h1>
      <p className="mt-1 text-sm text-stone-500">
        Ingresa los detalles de tu ingreso.
      </p>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="mt-6 flex flex-col gap-4"
      >
        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <label className="text-sm font-semibold text-stone-900">Fecha</label>
          <div className="mt-2 flex items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-emerald-600">
              <Calendar size={18} />
            </span>
            <span className="flex-1 text-sm text-stone-900">
              {formatDateLabel(today)}
            </span>
          </div>
          <input type="hidden" value={today} {...register("date")} />
          {errors.date && (
            <p className="mt-1 text-xs text-red-600">{errors.date.message}</p>
          )}
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={isDirectSavings}
              onChange={(e) => {
                setIsDirectSavings(e.target.checked);
                setSubmitError(null);
                setOverriddenFor(null);
                setValue("source", "");
                setValue("amount", "");
              }}
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm font-semibold text-stone-900">
                Va todo a Ahorro
              </span>
              <span className="block text-xs text-stone-500">
                Para dinero que no se reparte: una venta, un regalo, un extra
                que quieras guardar entero.
              </span>
            </span>
          </label>
        </div>

        {!isDirectSavings && (
        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <label
            htmlFor="source"
            className="text-sm font-semibold text-stone-900"
          >
            Fuente
          </label>
          <div className="relative mt-2 flex items-center gap-3 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <User size={18} />
            </span>
            <select
              id="source"
              {...register("source", {
                onChange: (e) => handleSourceChange(e.target.value),
              })}
              className="flex-1 appearance-none bg-transparent text-sm text-stone-900 outline-none"
            >
              <option value="">Selecciona una fuente</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <ChevronDown
              size={18}
              className="pointer-events-none text-stone-400"
            />
          </div>
          {errors.source && (
            <p className="mt-1 text-xs text-red-600">{errors.source.message}</p>
          )}
        </div>
        )}

        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <label
            htmlFor="amount"
            className="text-sm font-semibold text-stone-900"
          >
            Monto (S/)
          </label>
          <div className="mt-2 flex items-center gap-3 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-xs font-semibold text-emerald-600">
              S/
            </span>
            <input
              id="amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              placeholder="0.00"
              {...register("amount")}
              readOnly={isLocked}
              className={`flex-1 bg-transparent text-sm outline-none ${
                isLocked ? "text-stone-500" : "text-stone-900"
              }`}
            />
          </div>
          {errors.amount && (
            <p className="mt-1 text-xs text-red-600">{errors.amount.message}</p>
          )}
          {matchedFixedIncome && (
            <p className="mt-1 text-xs text-stone-400">
              {isLocked ? (
                <>
                  Ingreso fijo configurado.{" "}
                  <button
                    type="button"
                    onClick={() => setOverriddenFor(watchedSource ?? null)}
                    className="font-medium text-emerald-700 underline"
                  >
                    Registrar monto diferente este mes
                  </button>
                </>
              ) : (
                <>
                  Esto no cambia tu ingreso fijo configurado, solo esta
                  transacción.{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setOverriddenFor(null);
                      setValue(
                        "amount",
                        (
                          matchedFixedIncome.monthlyAmountCents / 100
                        ).toString(),
                      );
                    }}
                    className="font-medium text-emerald-700 underline"
                  >
                    Usar monto fijo
                  </button>
                </>
              )}
            </p>
          )}
        </div>

        {preview && (
          <div className="rounded-xl bg-sky-50 p-3">
            <p className="text-sm font-medium text-teal-700">
              Distribución inmediata
            </p>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-teal-700">
              <span>Necesidad +{formatCents(preview.necesidad)}</span>
              <span>Ocio +{formatCents(preview.ocio)}</span>
              <span>Ahorro +{formatCents(preview.ahorro)}</span>
            </div>
          </div>
        )}

        {isDirectSavings && previewCents > 0 && (
          <div className="rounded-xl bg-teal-50 p-3">
            <p className="text-sm font-medium text-teal-700">
              Ahorro +{formatCents(previewCents)}
            </p>
            <p className="mt-1 text-xs text-teal-700">
              No se reparte, así que tus topes de Necesidad y Ocio no cambian.
            </p>
          </div>
        )}

        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <label
            htmlFor="description"
            className="text-sm font-semibold text-stone-900"
          >
            Descripción{" "}
            <span className="font-normal text-emerald-600">(opcional)</span>
          </label>
          <div className="mt-2 flex items-center gap-3 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <FileText size={18} />
            </span>
            <input
              id="description"
              type="text"
              placeholder="Agrega una descripción"
              {...register("description")}
              className="flex-1 bg-transparent text-sm text-stone-900 outline-none"
            />
          </div>
        </div>

        {submitError && <p className="text-sm text-red-600">{submitError}</p>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-2 flex items-center justify-center gap-2 rounded-2xl bg-emerald-700 py-4 font-semibold text-white disabled:opacity-50"
        >
          <Save size={18} />
          {isSubmitting ? "Guardando..." : "Guardar ingreso"}
        </button>
      </form>
    </div>
  );
}
