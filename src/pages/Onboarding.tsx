import { useAuthStore } from "@/store/authStore";
import { updateUserProfile } from "@/services/userService";
import OnboardingFlow, {
  type OnboardingData,
} from "@/pages/onboarding/OnboardingFlow";

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

  if (!user || !userProfile) return null;

  const currentUser = user;
  const currentProfile = userProfile;

  async function handleFinish(data: OnboardingData) {
    const updatedProfile = { ...data, onboardingCompleted: true as const };
    await updateUserProfile(currentUser.uid, updatedProfile);
    setUserProfile({ ...currentProfile, ...updatedProfile });
  }

  return (
    <OnboardingFlow
      initialData={DEFAULT_DATA}
      onFinish={handleFinish}
      finishLabel="Comenzar"
    />
  );
}
