import { useEffect } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useAuthStore } from "@/store/authStore";
import type { User as UserProfile } from "@/types/user";
import AppRouter from "@/router";
import UpdatePrompt from "@/components/UpdatePrompt";

export default function App() {
  const { setUser, setUserProfile } = useAuthStore();

  useEffect(() => {
    let unsubProfile: (() => void) | undefined;

    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      console.log("Auth state changed:", firebaseUser?.uid);

      if (unsubProfile) {
        unsubProfile();
        unsubProfile = undefined;
      }

      if (firebaseUser) {
        const userRef = doc(db, "users", firebaseUser.uid);
        unsubProfile = onSnapshot(
          userRef,
          (snap) => {
            const profile = snap.exists() ? (snap.data() as UserProfile) : null;
            console.log("Profile loaded:", profile);
            setUserProfile(profile);
          },
          (err) => {
            console.error("onSnapshot userProfile falló:", err);
            setUserProfile(null);
          },
        );
      } else {
        setUserProfile(null);
      }

      setUser(firebaseUser);
    });

    return () => {
      unsubscribe();
      if (unsubProfile) unsubProfile();
    };
  }, [setUser, setUserProfile]);

  return (
    <>
      <UpdatePrompt />
      <AppRouter />
    </>
  );
}
