declare const __APP_BUILD_ID__: string | undefined;

export const DEFAULT_APP_BUILD_ID = "2026-11-18-diag-1";

/**
 * Extrae únicamente el código técnico de un error de Firebase/Firestore
 * (p. ej. "permission-denied", "failed-precondition", "unavailable"),
 * descartando rutas de documentos, UIDs o cualquier dato sensible.
 */
export function extractFirestoreErrorCode(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    const raw = (error as { code: string }).code.trim();
    if (raw.length > 0) {
      const normalized = raw.replace(/^(firestore|auth)\//, "");
      if (/^[a-z0-9-]+$/i.test(normalized)) {
        return normalized;
      }
    }
  }
  return null;
}

export function formatSaveErrorMessage(error: unknown): string {
  const code = extractFirestoreErrorCode(error);
  if (code) {
    return `No se pudo guardar (${code}). Revisa tu conexión e intenta de nuevo.`;
  }
  return "No se pudo guardar. Revisa tu conexión e intenta de nuevo.";
}

export function getAppBuildId(injectedBuildId?: string): string {
  const candidate =
    injectedBuildId ??
    (typeof __APP_BUILD_ID__ !== "undefined" ? __APP_BUILD_ID__ : undefined);
  return candidate && candidate.trim().length > 0
    ? candidate.trim()
    : DEFAULT_APP_BUILD_ID;
}

export function formatAppBuildLabel(injectedBuildId?: string): string {
  return `Versión: ${getAppBuildId(injectedBuildId)}`;
}
