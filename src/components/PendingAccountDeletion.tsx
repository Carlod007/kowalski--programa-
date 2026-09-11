import { useState } from "react";
import {
  deleteUser,
  EmailAuthProvider,
  reauthenticateWithCredential,
  signOut,
} from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { auth } from "@/lib/firebase";
import { useAuthStore } from "@/store/authStore";
import { forgetPendingAccountDeletion } from "@/utils/dataDeletion";

function getErrorMessage(error: unknown): string {
  if (error instanceof FirebaseError) {
    if (
      error.code === "auth/invalid-credential" ||
      error.code === "auth/wrong-password"
    ) {
      return "La contraseña no es correcta.";
    }
    if (error.code === "auth/network-request-failed") {
      return "No se pudo conectar. Revisa tu conexión a Internet.";
    }
  }
  return "No se pudo completar la eliminación. Intenta nuevamente.";
}

export default function PendingAccountDeletion() {
  const { user } = useAuthStore();
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user || !user.email) return null;
  const currentUser = user;

  async function completeDeletion() {
    if (!currentUser.email || password.length === 0) return;
    setWorking(true);
    setError(null);
    try {
      const credential = EmailAuthProvider.credential(
        currentUser.email,
        password,
      );
      await reauthenticateWithCredential(currentUser, credential);
      await deleteUser(currentUser);
      forgetPendingAccountDeletion();
      window.location.replace("/login?accountDeleted=success");
    } catch (deletionError) {
      setError(getErrorMessage(deletionError));
      setWorking(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-50 p-5">
      <div className="w-full max-w-sm rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
        <h1 className="text-lg font-semibold text-stone-900">
          Completar eliminación de cuenta
        </h1>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          Los datos ya fueron retirados, pero la cuenta quedó pendiente por una
          interrupción. Confirma tu contraseña para terminar.
        </p>
        <label className="mt-4 block text-sm text-stone-700">
          Contraseña
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={working}
            autoComplete="current-password"
            className="mt-2 w-full rounded-xl border border-stone-300 px-3 py-2.5 outline-none focus:border-red-400"
          />
        </label>
        {error && (
          <p className="mt-3 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={() => signOut(auth)}
            disabled={working}
            className="flex-1 rounded-xl border border-stone-300 py-2.5 text-sm text-stone-600 disabled:opacity-40"
          >
            Cerrar sesión
          </button>
          <button
            type="button"
            onClick={completeDeletion}
            disabled={working || password.length === 0}
            className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {working ? "Eliminando…" : "Eliminar cuenta"}
          </button>
        </div>
      </div>
    </main>
  );
}
