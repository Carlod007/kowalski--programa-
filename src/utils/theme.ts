export type AppTheme = "light" | "dark-neutral" | "dark-blue";

export const THEME_STORAGE_KEY = "kowalski-theme";

export function resolveTheme(
  storedTheme: string | null,
): AppTheme {
  if (storedTheme === "dark") return "dark-neutral";
  if (
    storedTheme === "light" ||
    storedTheme === "dark-neutral" ||
    storedTheme === "dark-blue"
  ) {
    return storedTheme;
  }
  return "light";
}

export function getStoredTheme(): AppTheme | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value ? resolveTheme(value) : null;
  } catch {
    return null;
  }
}

export function getResolvedTheme(): AppTheme {
  return getStoredTheme() ?? "light";
}

export function applyTheme(theme: AppTheme): void {
  if (typeof document === "undefined") return;
  const isDark = theme !== "light";
  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.classList.toggle(
    "dark-neutral",
    theme === "dark-neutral",
  );
  document.documentElement.classList.toggle("dark-blue", theme === "dark-blue");
  document.documentElement.style.colorScheme = isDark ? "dark" : "light";
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute(
      "content",
      theme === "dark-blue"
        ? "#15202b"
        : theme === "dark-neutral"
          ? "#0f0f0f"
          : "#10b981",
    );
}

export function initializeTheme(): AppTheme {
  const theme = getResolvedTheme();
  applyTheme(theme);
  return theme;
}

export function saveTheme(theme: AppTheme): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // El tema todavía se aplica durante esta sesión si el almacenamiento
      // del navegador no está disponible.
    }
  }
  applyTheme(theme);
}
