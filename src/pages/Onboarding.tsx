import { useAuthStore } from "@/store/authStore";
import { updateUserProfile } from "@/services/userService";
import OnboardingFlow, {
  type OnboardingData,
} from "@/pages/onboarding/OnboardingFlow";
import { useSearchParams } from "react-router-dom";

const DEFAULT_DATA: OnboardingData = {
  sources: [],
  fixedIncomes: [],
  essentialNeeds: [],
  distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
  subcategories: {
    necesidad: [],
    ocio: [],
  },
  paymentMethods: [],
};

export default function Onboarding() {
  const { user, userProfile, setUserProfile } = useAuthStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const resetSucceeded = searchParams.get("reset") === "success";

  if (!user || !userProfile) return null;

  const currentUser = user;
  const currentProfile = userProfile;

  async function handleFinish(data: OnboardingData) {
    const updatedProfile = { ...data, onboardingCompleted: true as const };
    await updateUserProfile(currentUser.uid, updatedProfile);
    setUserProfile({ ...currentProfile, ...updatedProfile });
  }

  return (
    <>
      {resetSucceeded && (
        <div
          role="status"
          onAnimationEnd={() => {
            searchParams.delete("reset");
            setSearchParams(searchParams, { replace: true });
          }}
          className="auto-dismiss-success fixed inset-x-4 top-4 z-50 mx-auto flex max-w-sm items-center justify-between gap-3 rounded-xl bg-emerald-700 px-4 py-3 text-white shadow-lg"
        >
          <p className="text-sm">Tus datos se eliminaron correctamente.</p>
          <button
            type="button"
            onClick={() => {
              searchParams.delete("reset");
              setSearchParams(searchParams, { replace: true });
            }}
            className="text-sm text-white/80"
          >
            Cerrar
          </button>
        </div>
      )}
      <OnboardingFlow
        initialData={DEFAULT_DATA}
        onFinish={handleFinish}
        finishLabel="Comenzar"
      />
    </>
  );
}
