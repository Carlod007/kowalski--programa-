import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";

export default function Onboarding() {
  async function handleSignOut() {
    await signOut(auth);
  }

  return (
    <div>
      <p>Onboarding</p>
      <button onClick={handleSignOut}>Salir</button>
    </div>
  );
}
