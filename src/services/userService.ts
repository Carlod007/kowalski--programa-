// src/services/userService.ts
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { User as UserProfile } from "@/types/user";

export async function getUserProfile(
  userId: string,
): Promise<UserProfile | null> {
  const ref = doc(db, "users", userId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data() as UserProfile;
}

export async function createUserProfile(
  userId: string,
  data: Pick<UserProfile, "name" | "email">,
): Promise<UserProfile> {
  const ref = doc(db, "users", userId);
  const profile: UserProfile = {
    name: data.name,
    email: data.email,
    sources: [],
    distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
    subcategories: {
      necesidad: [],
      ocio: [],
      ahorro: [],
    },
    paymentMethods: [],
    closingNotification: { day: 1, time: "18:00" },
    onboardingCompleted: false,
    lastClosedMonth: null,
  };
  await setDoc(ref, profile);
  return profile;
}

export async function updateUserProfile(
  userId: string,
  data: Partial<UserProfile>,
): Promise<void> {
  const ref = doc(db, "users", userId);
  await updateDoc(ref, data);
}
