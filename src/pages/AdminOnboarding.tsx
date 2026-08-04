import { useAuthStore } from "@/store/authStore";
import { updateUserProfile } from "@/services/userService";
import OnboardingFlow, {
  type OnboardingData,
} from "@/pages/onboarding/OnboardingFlow";
import BackButton from "@/components/BackButton";

export default function AdminOnboarding() {
  const { user, userProfile, setUserProfile } = useAuthStore();

  if (!user || !userProfile) return null;

  const currentUser = user;
  const currentProfile = userProfile;

  const initialData: OnboardingData = {
    sources: currentProfile.sources,
    fixedIncomes: currentProfile.fixedIncomes ?? [],
    essentialNeeds: currentProfile.essentialNeeds ?? [],
    distribution: currentProfile.distribution,
    subcategories: currentProfile.subcategories,
    paymentMethods: currentProfile.paymentMethods,
  };

  async function handleFinish(data: OnboardingData) {
    await updateUserProfile(currentUser.uid, data);
    setUserProfile({ ...currentProfile, ...data });
  }

  return (
    <div className="min-h-screen">
      <div className="px-5 pt-5">
        <BackButton to="/settings" />
      </div>
      <OnboardingFlow
        initialData={initialData}
        onFinish={handleFinish}
        finishLabel="Guardar cambios"
        confirmMessage="Esto cambia la configuración futura; no borra historial ni modifica el mes actual."
      />
    </div>
  );
}
