import { useState } from "react";
import { useAuthStore } from "@/store/authStore";
import { updateUserProfile } from "@/services/userService";
import type { Source, PaymentMethod } from "@/types/user";
import type { Distribution, Category } from "@/types/transaction";
import Step1Sources from "./onboarding/Step1Sources";
import Step2Distribution from "./onboarding/Step2Distribution";
import Step3Subcategories from "./onboarding/Step3Subcategories";
import Step4PaymentMethods from "./onboarding/Step4PaymentMethods";

type OnboardingData = {
  sources: Source[];
  distribution: Distribution;
  subcategories: Record<Category, string[]>;
  paymentMethods: PaymentMethod[];
};

const DEFAULT_DATA: OnboardingData = {
  sources: [],
  distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
  subcategories: {
    necesidad: [],
    ocio: [],
    ahorro: [],
  },
  paymentMethods: [],
};

export default function Onboarding() {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState<OnboardingData>(DEFAULT_DATA);
  const [error, setError] = useState<string | null>(null);
  const { user, userProfile, setUserProfile } = useAuthStore();

  const distributionValid =
    formData.distribution.necesidad +
      formData.distribution.ocio +
      formData.distribution.ahorro ===
    100;

  function next() {
    setStep((s) => s + 1);
  }

  function back() {
    setStep((s) => s - 1);
  }

  async function handleFinish() {
    if (!user || !userProfile) return;
    try {
      const updatedProfile = {
        sources: formData.sources,
        distribution: formData.distribution,
        subcategories: formData.subcategories,
        paymentMethods: formData.paymentMethods,
        onboardingCompleted: true as const,
      };
      await updateUserProfile(user.uid, updatedProfile);
      setUserProfile({
        ...userProfile,
        ...updatedProfile,
      });
    } catch {
      setError("Error al guardar. Verifica tu conexión.");
    }
  }

  return (
    <div className="flex min-h-screen flex-col p-5">
      <p className="mb-6 text-xs text-gray-400">Paso {step} de 4</p>

      {step === 1 && (
        <Step1Sources
          data={formData.sources}
          onChange={(sources) => setFormData((d) => ({ ...d, sources }))}
        />
      )}
      {step === 2 && (
        <Step2Distribution
          data={formData.distribution}
          onChange={(distribution) =>
            setFormData((d) => ({ ...d, distribution }))
          }
        />
      )}
      {step === 3 && (
        <Step3Subcategories
          data={formData.subcategories}
          onChange={(subcategories) =>
            setFormData((d) => ({ ...d, subcategories }))
          }
        />
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
              className="flex-1 rounded-lg border py-3 text-sm"
            >
              Atrás
            </button>
          )}
          <button
            onClick={step === 4 ? handleFinish : next}
            disabled={step === 2 && !distributionValid}
            className="flex-1 rounded-lg bg-teal-600 py-3 text-sm font-medium text-white disabled:opacity-50"
          >
            {step === 4 ? "Comenzar" : "Siguiente"}
          </button>
        </div>
      </div>
    </div>
  );
}
