import { useEffect } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuthStore } from "@/store/authStore";
import { getUserProfile } from "@/services/userService";
import AppRouter from "@/router";

export default function App() {
  const { setUser, setUserProfile } = useAuthStore();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      console.log("Auth state changed:", firebaseUser?.uid);

      if (firebaseUser) {
        const profile = await getUserProfile(firebaseUser.uid);
        console.log("Profile loaded:", profile);
        setUserProfile(profile);
      } else {
        setUserProfile(null);
      }

      setUser(firebaseUser);
    });

    return unsubscribe;
  }, [setUser, setUserProfile]);

  return <AppRouter />;
}
