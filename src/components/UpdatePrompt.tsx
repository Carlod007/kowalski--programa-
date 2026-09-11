import { useEffect, useRef, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

type UpdateStatus = "idle" | "updating" | "success" | "error";

const UPDATE_COMPLETED_KEY = "kowalski:pwa-update-completed";
const UPDATE_TIMEOUT_MS = 12_000;

function rememberCompletedUpdate(): void {
  try {
    localStorage.setItem(UPDATE_COMPLETED_KEY, String(Date.now()));
  } catch {
    // La actualización puede continuar aunque el navegador bloquee storage.
  }
}

function forgetCompletedUpdate(): void {
  try {
    localStorage.removeItem(UPDATE_COMPLETED_KEY);
  } catch {
    // No hay nada más que limpiar si storage no está disponible.
  }
}

function consumeCompletedUpdate(): boolean {
  try {
    const storedAt = Number(localStorage.getItem(UPDATE_COMPLETED_KEY));
    localStorage.removeItem(UPDATE_COMPLETED_KEY);
    return Number.isFinite(storedAt) && Date.now() - storedAt < 60_000;
  } catch {
    return false;
  }
}

const UPDATE_COMPLETED_ON_LOAD = consumeCompletedUpdate();

export default function UpdatePrompt() {
  const [status, setStatus] = useState<UpdateStatus>(
    UPDATE_COMPLETED_ON_LOAD ? "success" : "idle",
  );
  const updateTimeoutRef = useRef<number | null>(null);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onNeedReload() {
      if (updateTimeoutRef.current !== null) {
        window.clearTimeout(updateTimeoutRef.current);
      }
      rememberCompletedUpdate();
      setStatus("success");
      window.location.reload();
    },
    onRegisterError(error) {
      console.error("Error al registrar el service worker:", error);
      forgetCompletedUpdate();
      setStatus("error");
    },
  });

  useEffect(() => {
    return () => {
      if (updateTimeoutRef.current !== null) {
        window.clearTimeout(updateTimeoutRef.current);
      }
    };
  }, []);

  async function handleUpdate(): Promise<void> {
    if (updateTimeoutRef.current !== null) {
      window.clearTimeout(updateTimeoutRef.current);
    }
    setStatus("updating");
    // Se guarda antes de activar el nuevo worker porque algunos navegadores
    // recargan la página antes de notificar el evento `controlling`.
    rememberCompletedUpdate();
    try {
      await updateServiceWorker(true);
      updateTimeoutRef.current = window.setTimeout(() => {
        forgetCompletedUpdate();
        setStatus("error");
      }, UPDATE_TIMEOUT_MS);
    } catch (error) {
      console.error("No se pudo actualizar la aplicación:", error);
      forgetCompletedUpdate();
      setStatus("error");
    }
  }

  if (!needRefresh && status === "idle") return null;

  const isUpdating = status === "updating";
  const isSuccess = status === "success";
  const isError = status === "error";

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed inset-x-0 top-0 z-50 flex items-center justify-between gap-3 px-5 py-3 text-white ${
        isSuccess ? "bg-emerald-700" : isError ? "bg-red-700" : "bg-stone-900"
      }`}
    >
      <p className="text-sm">
        {isUpdating
          ? "Actualizando la aplicación…"
          : isSuccess
            ? "Actualización completada correctamente"
            : isError
              ? "No se pudo actualizar. Revisa tu conexión e inténtalo de nuevo."
              : "Hay una nueva versión disponible"}
      </p>
      <div className="flex shrink-0 gap-2">
        {(isSuccess || (isError && !needRefresh)) && (
          <button
            type="button"
            onClick={() => setStatus("idle")}
            className="rounded-lg px-3 py-1.5 text-sm text-white/80"
          >
            Cerrar
          </button>
        )}
        {!isSuccess && needRefresh && (
          <>
            {!isUpdating && !isError && (
              <button
                type="button"
                onClick={() => setNeedRefresh(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-stone-300"
              >
                Más tarde
              </button>
            )}
            <button
              type="button"
              onClick={handleUpdate}
              disabled={isUpdating}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
            >
              {isUpdating ? "Actualizando…" : isError ? "Reintentar" : "Actualizar ahora"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
