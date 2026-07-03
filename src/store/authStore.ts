// src/store/authStore.ts
import { create } from "zustand";
import type { User } from "firebase/auth";

interface AuthState {
  user: User | null;
  isAuthLoading: boolean;
  setUser: (user: User | null) => void;
  setAuthLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthLoading: true,
  setUser: (user) => set({ user, isAuthLoading: false }),
  setAuthLoading: (loading) => set({ isAuthLoading: loading }),
}));
