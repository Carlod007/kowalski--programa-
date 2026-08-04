import { useState } from "react";
import { calculateMinimumNecesidadPercentage } from "@/utils/distribution";
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
  const minNecesidad = calculateMinimumNecesidadPercentage(
    fixedIncomesTotalCents,
    essentialNeedsTotalCents,
  );
  const hasDeficit = minNecesidad > 100;
  const deficitKey = `${fixedIncomesTotalCents}:${essentialNeedsTotalCents}`;
  const deficitAcknowledged = acknowledgedDeficitKey === deficitKey;

  const distributionValid =
    formData.distribution.necesidad +
      formData.distribution.ocio +
      formData.distribution.ahorro ===
    100;
  const necesidadMeetsMinimum = formData.distribution.necesidad >= minNecesidad;

  function next() {
    setStep((s) => s + 1);
  }

  function back() {
    setStep((s) => s - 1);
  }

  const canAdvance =
    step === 1
      ? fixedIncomesTotalCents > 0
      : step === 3
        ? distributionValid &&
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
          onChange={(sources, fixedIncomes) =>
            setFormData((d) => ({ ...d, sources, fixedIncomes }))
          }
        />
      )}
      {step === 2 && (
        <Step3Subcategories
          data={formData.subcategories}
          essentialNeeds={formData.essentialNeeds}
          onChange={(subcategories, essentialNeeds) =>
            setFormData((d) => ({ ...d, subcategories, essentialNeeds }))
          }
        />
      )}
      {step === 3 && (
        <>
          <Step2Distribution
            data={formData.distribution}
            onChange={(distribution) =>
              setFormData((d) => ({ ...d, distribution }))
            }
            minNecesidad={hasDeficit ? undefined : minNecesidad}
          />
          {hasDeficit && (
            <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm text-amber-800">
                Tus necesidades ({formatCents(essentialNeedsTotalCents)})
                superan tus ingresos fijos ({formatCents(fixedIncomesTotalCents)}
                ) en{" "}
                {formatCents(essentialNeedsTotalCents - fixedIncomesTotalCents)}
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
