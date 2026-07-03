import { create } from "zustand";
import type { User } from "firebase/auth";
import type { User as UserProfile } from "@/types/user";

interface AuthState {
  user: User | null;
  userProfile: UserProfile | null;
  isAuthLoading: boolean;
  isProfileLoading: boolean;
  setUser: (user: User | null) => void;
  setUserProfile: (profile: UserProfile | null) => void;
  setAuthLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  userProfile: null,
  isAuthLoading: true,
  isProfileLoading: true,
  setUser: (user) => set({ user, isAuthLoading: false }),
  setUserProfile: (profile) =>
    set({ userProfile: profile, isProfileLoading: false }),
  setAuthLoading: (loading) => set({ isAuthLoading: loading }),
}));
