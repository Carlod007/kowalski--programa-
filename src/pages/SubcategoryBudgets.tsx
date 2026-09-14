import { useState } from "react";
import BackButton from "@/components/BackButton";
import { useAuthStore } from "@/store/authStore";
import { saveSubcategoryBudgets } from "@/services/subcategoryBudgetService";
import { CATEGORY_META } from "@/utils/category";
import { getSubcategoryBudgetKey } from "@/utils/subcategoryBudgets";
import type { SubcategoryBudget } from "@/types/user";

export default function SubcategoryBudgets() {
  const { user, userProfile } = useAuthStore();
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (userProfile?.subcategoryBudgets ?? []).map((budget) => [
        getSubcategoryBudgetKey(budget.category, budget.subcategory),
        (budget.monthlyLimitCents / 100).toFixed(2),
      ]),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user || !userProfile) return null;
  const currentUser = user;
  const currentProfile = userProfile;
  const categories = ["necesidad", "ocio"] as const;
  const hasSubcategories = categories.some(
    (category) => currentProfile.subcategories[category].length > 0,
  );

  async function handleSave() {
    const budgets: SubcategoryBudget[] = [];
    for (const category of categories) {
      for (const subcategory of currentProfile.subcategories[category]) {
        const value = draft[getSubcategoryBudgetKey(category, subcategory)]?.trim();
        if (!value) continue;
        const amount = Number(value);
        if (!Number.isFinite(amount) || amount <= 0) {
          setError("Todos los límites deben ser mayores a cero o quedar vacíos");
          return;
        }
        budgets.push({
          category,
          subcategory,
          monthlyLimitCents: Math.round(amount * 100),
        });
      }
    }

    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await saveSubcategoryBudgets(currentUser.uid, budgets);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2_500);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudieron guardar los presupuestos",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-dvh bg-stone-50 pb-10">
      <header className="flex items-center gap-3 px-5 pt-8">
        <BackButton to="/settings" />
        <div>
          <h1 className="text-xl font-semibold text-stone-900">
            Presupuestos por subcategoría
          </h1>
          <p className="text-sm text-stone-500">
            Límites mensuales informativos y opcionales.
          </p>
        </div>
      </header>

      <main className="px-5">
        <div className="mt-6 rounded-2xl border border-teal-100 bg-teal-50 p-4 text-sm text-teal-800">
          No cambia tus porcentajes, topes ni saldos. Un gasto nunca será
          bloqueado por superar estos límites.
        </div>

        {!hasSubcategories ? (
          <p className="mt-6 rounded-2xl border border-dashed border-stone-300 bg-white p-5 text-center text-sm text-stone-500">
            Primero agrega subcategorías desde Configuración.
          </p>
        ) : (
          categories.map((category) =>
            userProfile.subcategories[category].length > 0 ? (
              <section key={category} className="mt-6">
                <h2
                  className={`text-sm font-medium ${CATEGORY_META[category].text}`}
                >
                  {CATEGORY_META[category].label}
                </h2>
                <div className="mt-2 divide-y divide-stone-100 rounded-2xl border border-stone-200 bg-white">
                  {userProfile.subcategories[category].map((subcategory) => {
                    const key = getSubcategoryBudgetKey(category, subcategory);
                    return (
                      <label
                        key={key}
                        className="flex items-center justify-between gap-4 px-4 py-3"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm text-stone-700">
                          {subcategory}
                        </span>
                        <span className="flex items-center gap-1 text-sm text-stone-400">
                          S/
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0.01"
                            step="0.01"
                            aria-label={`Límite de ${subcategory}`}
                            value={draft[key] ?? ""}
                            onChange={(event) => {
                              setSaved(false);
                              setError(null);
                              setDraft((current) => ({
                                ...current,
                                [key]: event.target.value,
                              }));
                            }}
                            placeholder="Sin límite"
                            className="w-28 rounded-lg border border-stone-300 px-2 py-1.5 text-right text-stone-900 outline-none"
                          />
                        </span>
                      </label>
                    );
                  })}
                </div>
              </section>
            ) : null,
          )
        )}

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        {saved && (
          <p role="status" className="mt-4 text-sm text-emerald-700">
            Presupuestos guardados correctamente.
          </p>
        )}
        {hasSubcategories && (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="mt-6 w-full rounded-xl bg-stone-900 py-3 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar presupuestos"}
          </button>
        )}
      </main>
    </div>
  );
}
