import { useState } from "react";
import { getMinimumNecesidadRecommendation } from "@/utils/distribution";
import { formatCents } from "@/utils/currency";
import type {
  Source,
  PaymentMethod,
  FixedIncome,
  EssentialNeed,
} from "@/types/user";
import type { Distribution } from "@/types/transaction";
import StepIncomeSources from "./StepIncomeSources";
import Step2Distribution from "./Step2Distribution";
import Step3Subcategories from "./Step3Subcategories";
import Step4PaymentMethods from "./Step4PaymentMethods";

export type OnboardingData = {
  sources: Source[];
  fixedIncomes: FixedIncome[];
  essentialNeeds: EssentialNeed[];
  distribution: Distribution;
  subcategories: Record<"necesidad" | "ocio", string[]>;
  paymentMethods: PaymentMethod[];
};

const TOTAL_STEPS = 4;

function parseOptionalReferenceIncome(value: string): {
  cents: number;
  invalid: boolean;
} {
  if (value.trim() === "") return { cents: 0, invalid: false };
  const parsed = Number(value);
  const cents = Math.round(parsed * 100);
  if (!Number.isFinite(parsed) || !Number.isSafeInteger(cents) || cents <= 0) {
    return { cents: 0, invalid: true };
  }
  return { cents, invalid: false };
}

type Props = {
  initialData: OnboardingData;
  onFinish: (data: OnboardingData) => Promise<void>;
  finishLabel: string;
  confirmMessage?: string;
};

export default function OnboardingFlow({
  initialData,
  onFinish,
  finishLabel,
  confirmMessage,
}: Props) {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState<OnboardingData>(initialData);
  const [referenceIncomeInput, setReferenceIncomeInput] = useState("");
  const [acknowledgedDeficitKey, setAcknowledgedDeficitKey] = useState<
    string | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const fixedIncomesTotalCents = formData.fixedIncomes.reduce(
    (sum, i) => sum + i.monthlyAmountCents,
    0,
  );
  const essentialNeedsTotalCents = formData.essentialNeeds.reduce(
    (sum, n) => sum + n.monthlyAmountCents,
    0,
  );
  const referenceIncome = parseOptionalReferenceIncome(referenceIncomeInput);
  const referenceApplies =
    fixedIncomesTotalCents === 0 && essentialNeedsTotalCents > 0;
  const minimumRecommendation = getMinimumNecesidadRecommendation(
    fixedIncomesTotalCents,
    essentialNeedsTotalCents,
    referenceApplies && !referenceIncome.invalid ? referenceIncome.cents : 0,
  );
  const minNecesidad = minimumRecommendation.percentage;
  const hasDeficit = minNecesidad !== null && minNecesidad > 100;
  const deficitKey = `${minimumRecommendation.basis}:${minimumRecommendation.basisCents}:${essentialNeedsTotalCents}`;
  const deficitAcknowledged = acknowledgedDeficitKey === deficitKey;

  const distributionValid =
    formData.distribution.necesidad +
      formData.distribution.ocio +
      formData.distribution.ahorro ===
    100;
  const necesidadMeetsMinimum =
    minNecesidad === null || formData.distribution.necesidad >= minNecesidad;

  function next() {
    setStep((s) => s + 1);
  }

  function back() {
    setAcknowledgedDeficitKey(null);
    setStep((s) => s - 1);
  }

  const canAdvance =
    step === 1
      ? formData.sources.length > 0
      : step === 3
        ? (!referenceApplies || !referenceIncome.invalid) &&
          distributionValid &&
          (hasDeficit ? deficitAcknowledged : necesidadMeetsMinimum)
        : true;

  async function persist() {
    setSaving(true);
    setError(null);
    try {
      await onFinish(formData);
    } catch {
      setError("Error al guardar. Verifica tu conexión.");
    } finally {
      setSaving(false);
    }
  }

  function handleFinishClick() {
    if (confirmMessage) {
      setShowConfirm(true);
    } else {
      persist();
    }
  }

  return (
    <div className="flex min-h-screen flex-col p-5">
      <p className="mb-6 text-xs text-gray-400">
        Paso {step} de {TOTAL_STEPS}
      </p>

      {step === 1 && (
        <StepIncomeSources
          sources={formData.sources}
          fixedIncomes={formData.fixedIncomes}
          onChange={(sources, fixedIncomes) => {
            setAcknowledgedDeficitKey(null);
            setFormData((d) => ({ ...d, sources, fixedIncomes }));
          }}
        />
      )}
      {step === 1 && formData.sources.length === 0 && (
        <p className="mt-3 text-xs text-amber-700">
          Agrega al menos una fuente para continuar.
        </p>
      )}
      {step === 2 && (
        <Step3Subcategories
          data={formData.subcategories}
          essentialNeeds={formData.essentialNeeds}
          onChange={(subcategories, essentialNeeds) => {
            setAcknowledgedDeficitKey(null);
            setFormData((d) => ({ ...d, subcategories, essentialNeeds }));
          }}
        />
      )}
      {step === 3 && (
        <>
          {referenceApplies && (
            <div className="mb-5 rounded-xl border border-stone-200 bg-white p-4">
              <label
                htmlFor="reference-income"
                className="text-sm font-medium text-stone-900"
              >
                Ingreso mensual de referencia (opcional)
              </label>
              <p className="mt-1 text-xs text-stone-500">
                Usa un estimado o promedio. Solo calcula esta recomendación
                inicial: no registra dinero, no crea una transacción y no se
                guarda al terminar.
              </p>
              <div className="mt-3 flex items-center rounded-lg bg-stone-50 px-3 py-2">
                <span className="mr-2 text-sm text-stone-500">S/</span>
                <input
                  id="reference-income"
                  value={referenceIncomeInput}
                  onChange={(event) => {
                    setReferenceIncomeInput(event.target.value);
                    setAcknowledgedDeficitKey(null);
                  }}
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  className="min-w-0 flex-1 bg-transparent text-sm text-stone-900 outline-none"
                />
              </div>
              {referenceIncome.invalid && (
                <p className="mt-1 text-xs text-red-500">
                  Si indicas una referencia, debe ser mayor a 0.
                </p>
              )}
            </div>
          )}
          <Step2Distribution
            data={formData.distribution}
            onChange={(distribution) =>
              setFormData((d) => ({ ...d, distribution }))
            }
            minNecesidad={
              minNecesidad !== null && !hasDeficit
                ? minNecesidad
                : undefined
            }
            minimumUnavailableMessage={
              minimumRecommendation.basis === null
                ? essentialNeedsTotalCents > 0
                  ? `Mínimo no calculable: tienes ${formatCents(essentialNeedsTotalCents)} de gastos fijos y no has indicado ingresos fijos ni una referencia. Puedes continuar con un reparto manual.`
                  : "Mínimo no calculable: no has indicado ingresos fijos. Puedes continuar con un reparto manual."
                : undefined
            }
          />
          {hasDeficit && (
            <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm text-amber-800">
                Tus necesidades ({formatCents(essentialNeedsTotalCents)})
                superan {minimumRecommendation.basis === "fixed-income"
                  ? "tus ingresos fijos"
                  : "tu ingreso de referencia"} ({formatCents(minimumRecommendation.basisCents)}) en{" "}
                {formatCents(
                  essentialNeedsTotalCents - minimumRecommendation.basisCents,
                )}
                . Ningún reparto puede cubrir esto sin corregir tus ingresos o
                necesidades.
              </p>
              <label className="mt-2 flex items-center gap-2 text-sm text-amber-800">
                <input
                  type="checkbox"
                  checked={deficitAcknowledged}
                  onChange={(e) =>
                    setAcknowledgedDeficitKey(
                      e.target.checked ? deficitKey : null,
                    )
                  }
                />
                Continuar con déficit
              </label>
            </div>
          )}
        </>
      )}
      {step === 4 && (
        <Step4PaymentMethods
          data={formData.paymentMethods}
          onChange={(paymentMethods) =>
            setFormData((d) => ({ ...d, paymentMethods }))
          }
        />
      )}

      <div className="mt-auto flex flex-col gap-3">
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-3">
          {step > 1 && (
            <button
              onClick={back}
              disabled={saving}
              className="flex-1 rounded-lg border py-3 text-sm"
            >
              Atrás
            </button>
          )}
          <button
            onClick={step === TOTAL_STEPS ? handleFinishClick : next}
            disabled={!canAdvance || saving}
            className="flex-1 rounded-lg bg-teal-600 py-3 text-sm font-medium text-white disabled:opacity-50"
          >
            {step === TOTAL_STEPS
              ? saving
                ? "Guardando..."
                : finishLabel
              : "Siguiente"}
          </button>
        </div>
      </div>

      {showConfirm && confirmMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5">
            <p className="text-sm text-stone-900">{confirmMessage}</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className="flex-1 rounded-lg border border-stone-300 py-2 text-sm text-stone-600"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowConfirm(false);
                  persist();
                }}
                className="flex-1 rounded-lg bg-teal-600 py-2 text-sm font-medium text-white"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
