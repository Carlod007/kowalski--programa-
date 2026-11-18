import { describe, expect, it } from "vitest";
import {
  DEFAULT_APP_BUILD_ID,
  extractFirestoreErrorCode,
  formatAppBuildLabel,
  formatSaveErrorMessage,
  getAppBuildId,
} from "./diagnostics";

describe("diagnóstico de guardado y versión de build", () => {
  it("incluye el código real de Firestore en el mensaje de error sin exponer datos sensibles", () => {
    const permissionError = {
      code: "firestore/permission-denied",
      message: "Missing or insufficient permissions at users/secret-uid-123",
    };
    expect(extractFirestoreErrorCode(permissionError)).toBe("permission-denied");
    expect(formatSaveErrorMessage(permissionError)).toBe(
      "No se pudo guardar (permission-denied). Revisa tu conexión e intenta de nuevo.",
    );
    expect(formatSaveErrorMessage(permissionError)).not.toContain(
      "secret-uid-123",
    );

    const preconditionError = { code: "failed-precondition" };
    expect(formatSaveErrorMessage(preconditionError)).toBe(
      "No se pudo guardar (failed-precondition). Revisa tu conexión e intenta de nuevo.",
    );
  });

  it("usa el mensaje genérico cuando el error no tiene código técnico válido", () => {
    expect(extractFirestoreErrorCode(new Error("Fallo arbitrario"))).toBeNull();
    expect(formatSaveErrorMessage(new Error("Fallo arbitrario"))).toBe(
      "No se pudo guardar. Revisa tu conexión e intenta de nuevo.",
    );
    expect(formatSaveErrorMessage(null)).toBe(
      "No se pudo guardar. Revisa tu conexión e intenta de nuevo.",
    );
  });

  it("formatea el identificador de versión/build visible para Ajustes", () => {
    expect(getAppBuildId("2026-11-18 02:25 UTC")).toBe("2026-11-18 02:25 UTC");
    expect(formatAppBuildLabel("2026-11-18 02:25 UTC")).toBe(
      "Versión: 2026-11-18 02:25 UTC",
    );
    expect(getAppBuildId("")).toBe(DEFAULT_APP_BUILD_ID);
  });
});
