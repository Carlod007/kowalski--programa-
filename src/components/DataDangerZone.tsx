import { useState } from "react";
import {
  deleteUser,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { useAuthStore } from "@/store/authStore";
import {
  deleteAllAccountData,
  resetAllUserData,
  restorePendingAccountDeletion,
  type DataDeletionProgress,
} from "@/services/accountDataService";
import type { DataDeletionMode } from "@/types/user";
import {
  forgetPendingAccountDeletion,
  rememberPendingAccountDeletion,
} from "@/utils/dataDeletion";

type DialogStep = "idle" | "warning" | "password" | "working" | "error";

function getFriendlyError(error: unknown): string {
  if (error instanceof FirebaseError) {
    if (
      error.code === "auth/invalid-credential" ||
      error.code === "auth/wrong-password"
    ) {
      return "La contraseña no es correcta.";
    }
    if (error.code === "auth/too-many-requests") {
      return "Hubo demasiados intentos. Espera unos minutos y vuelve a intentar.";
    }
    if (error.code === "auth/network-request-failed") {
      return "No se pudo conectar. Revisa tu conexión a Internet.";
    }
  }
  return error instanceof Error
    ? error.message
    : "No se pudo completar la operación. Intenta nuevamente.";
}

export default function DataDangerZone() {
  const { user, userProfile, setUserProfile } = useAuthStore();
  const pendingMode = userProfile?.dataDeletionMode;
  const [mode, setMode] = useState<DataDeletionMode | null>(
    pendingMode ?? null,
  );
  const [step, setStep] = useState<DialogStep>(
    pendingMode ? "password" : "idle",
  );
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<DataDeletionProgress>({
    stage: "Preparando la limpieza…",
    deletedDocuments: 0,
  });

  if (!user || !userProfile) return null;

  const currentUser = user;
  const currentProfile = userProfile;
  const isAccountDeletion = mode === "delete-account";

  function openDialog(nextMode: DataDeletionMode) {
    setMode(nextMode);
    setPassword("");
    setError(null);
    setStep("warning");
  }

  function closeDialog() {
    setMode(null);
    setPassword("");
    setError(null);
    setStep("idle");
  }

  async function confirmAction() {
    if (!mode || !currentUser.email || password.length === 0) return;

    setError(null);
    try {
      const credential = EmailAuthProvider.credential(
        currentUser.email,
        password,
      );
      await reauthenticateWithCredential(currentUser, credential);
    } catch (reauthError) {
      setError(getFriendlyError(reauthError));
      return;
    }

    setStep("working");
    setProgress({
      stage: "Preparando la limpieza…",
      deletedDocuments: 0,
    });

    try {
      if (mode === "reset") {
        const blankProfile = await resetAllUserData(
          currentUser.uid,
          { name: currentProfile.name, email: currentProfile.email },
          setProgress,
        );
        setUserProfile(blankProfile);
        window.location.replace("/onboarding?reset=success");
        return;
      }

      rememberPendingAccountDeletion(currentUser.uid);
      await deleteAllAccountData(currentUser.uid, setProgress);
      try {
        await deleteUser(currentUser);
      } catch (deleteError) {
        await restorePendingAccountDeletion(currentUser.uid, {
          name: currentProfile.name,
          email: currentProfile.email,
        });
        throw deleteError;
      }
      forgetPendingAccountDeletion();
      window.location.replace("/login?accountDeleted=success");
    } catch (actionError) {
      console.error("No se pudo completar la limpieza:", actionError);
      setError(getFriendlyError(actionError));
      setStep("error");
    }
  }

  return (
    <section className="mx-5 mt-8">
      <h2 className="text-xs font-medium uppercase tracking-wide text-red-500">
        Zona de riesgo
      </h2>
      <div className="mt-2 overflow-hidden rounded-2xl border border-red-200 bg-white">
        <button
          type="button"
          onClick={() => openDialog("reset")}
          className="w-full border-b border-red-100 px-4 py-3 text-left"
        >
          <span className="block text-sm font-medium text-red-600">
            Reiniciar todos mis datos
          </span>
          <span className="mt-0.5 block text-xs text-stone-400">
            Conserva tu cuenta y vuelve a configurar todo desde cero.
          </span>
        </button>
        <button
          type="button"
          onClick={() => openDialog("delete-account")}
          className="w-full px-4 py-3 text-left"
        >
          <span className="block text-sm font-medium text-red-700">
            Eliminar mi cuenta
          </span>
          <span className="mt-0.5 block text-xs text-stone-400">
            Borra definitivamente la cuenta y todos sus datos.
          </span>
        </button>
      </div>

      {step !== "idle" && mode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-5">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="danger-dialog-title"
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
          >
            <h3
              id="danger-dialog-title"
              className="text-lg font-semibold text-stone-900"
            >
              {isAccountDeletion
                ? "Eliminar cuenta y datos"
                : "Reiniciar todos los datos"}
            </h3>

            {step === "warning" && (
              <>
                <p className="mt-3 text-sm leading-6 text-stone-600">
                  {isAccountDeletion
                    ? "Se eliminarán permanentemente tu historial, meses cerrados, metas, préstamos, tarjetas, configuración y acceso a la cuenta."
                    : "Se eliminarán permanentemente tu historial, meses cerrados, metas, préstamos, tarjetas y configuración financiera. Tu correo y cuenta se conservarán."}
                </p>
                <p className="mt-2 text-sm font-medium text-red-600">
                  Esta acción no se puede deshacer.
                </p>
                <div className="mt-5 flex gap-2">
                  <button
                    type="button"
                    onClick={closeDialog}
                    autoFocus
                    className="flex-1 rounded-xl border border-stone-300 py-2.5 text-sm text-stone-600"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep("password")}
                    className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-medium text-white"
                  >
                    Continuar
                  </button>
                </div>
              </>
            )}

            {step === "password" && (
              <>
                {pendingMode && (
                  <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
                    Hay una limpieza pendiente. Confirma tu contraseña para
                    continuarla de forma segura.
                  </p>
                )}
                <label className="mt-4 block text-sm text-stone-700">
                  Confirma tu contraseña
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                    autoFocus
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
                    onClick={pendingMode ? () => undefined : closeDialog}
                    disabled={!!pendingMode}
                    className="flex-1 rounded-xl border border-stone-300 py-2.5 text-sm text-stone-600 disabled:opacity-40"
                  >
                    {pendingMode ? "Proceso pendiente" : "Volver"}
                  </button>
                  <button
                    type="button"
                    onClick={confirmAction}
                    disabled={password.length === 0}
                    className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-medium text-white disabled:opacity-40"
                  >
                    {isAccountDeletion
                      ? "Eliminar definitivamente"
                      : "Confirmar reinicio"}
                  </button>
                </div>
              </>
            )}

            {step === "working" && (
              <div className="mt-5" role="status" aria-live="polite">
                <p className="text-sm text-stone-700">{progress.stage}</p>
                <p className="mt-2 text-xs text-stone-400">
                  {progress.deletedDocuments} documentos eliminados
                </p>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-stone-100">
                  <div className="h-full w-2/3 animate-pulse rounded-full bg-red-500" />
                </div>
                <p className="mt-3 text-xs text-stone-400">
                  No cierres la aplicación hasta que termine.
                </p>
              </div>
            )}

            {step === "error" && (
              <>
                <p className="mt-3 text-sm text-red-600" role="alert">
                  {error}
                </p>
                <p className="mt-2 text-xs text-stone-500">
                  El proceso es reanudable. Los datos ya eliminados no volverán
                  a aparecer.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setPassword("");
                    setError(null);
                    setStep("password");
                  }}
                  className="mt-5 w-full rounded-xl bg-red-600 py-2.5 text-sm font-medium text-white"
                >
                  Reintentar
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
