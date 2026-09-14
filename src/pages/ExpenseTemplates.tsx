import { useState } from "react";
import { Link } from "react-router-dom";
import BackButton from "@/components/BackButton";
import { useAuthStore } from "@/store/authStore";
import {
  deleteExpenseTemplate,
  saveExpenseTemplate,
} from "@/services/expenseTemplateService";
import { CATEGORY_META } from "@/utils/category";
import { formatCents } from "@/utils/currency";
import {
  getExpenseTemplateLabel,
  isExpenseTemplateUsable,
  MAX_EXPENSE_TEMPLATES,
} from "@/utils/expenseTemplates";
import type { ExpenseTemplate } from "@/types/user";

type TemplateDraft = {
  category: "necesidad" | "ocio";
  subcategory: string;
  amount: string;
  description: string;
  paymentMethod: string;
};

const EMPTY_DRAFT: TemplateDraft = {
  category: "necesidad",
  subcategory: "",
  amount: "",
  description: "",
  paymentMethod: "",
};

export default function ExpenseTemplates() {
  const { user, userProfile } = useAuthStore();
  const [expanded, setExpanded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TemplateDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  if (!user || !userProfile) return null;

  const currentUser = user;
  const templates = userProfile.expenseTemplates ?? [];
  const availableSubcategories =
    userProfile.subcategories[draft.category] ?? [];

  function beginCreate() {
    setDraft(EMPTY_DRAFT);
    setEditingId(null);
    setError(null);
    setExpanded(true);
  }

  function beginEdit(template: ExpenseTemplate) {
    setDraft({
      category: template.category,
      subcategory: template.subcategory,
      amount: template.amountCents
        ? (template.amountCents / 100).toFixed(2)
        : "",
      description: template.description ?? "",
      paymentMethod: template.paymentMethod,
    });
    setEditingId(template.id);
    setError(null);
    setExpanded(true);
  }

  async function handleSave() {
    const amount = draft.amount.trim() ? Number(draft.amount) : null;
    if (!draft.subcategory || !draft.paymentMethod) {
      setError("Selecciona una subcategoría y un método de pago");
      return;
    }
    if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) {
      setError("El monto debe ser mayor a cero o quedar vacío");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await saveExpenseTemplate(currentUser.uid, {
        id: editingId ?? crypto.randomUUID(),
        category: draft.category,
        subcategory: draft.subcategory,
        paymentMethod: draft.paymentMethod,
        ...(amount !== null ? { amountCents: Math.round(amount * 100) } : {}),
        ...(draft.description.trim()
          ? { description: draft.description.trim() }
          : {}),
      });
      setExpanded(false);
      setEditingId(null);
      setDraft(EMPTY_DRAFT);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo guardar el gasto frecuente",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(templateId: string) {
    if (confirmDeleteId !== templateId) {
      setConfirmDeleteId(templateId);
      return;
    }
    setConfirmDeleteId(null);
    try {
      await deleteExpenseTemplate(currentUser.uid, templateId);
    } catch (err) {
      console.error("No se pudo eliminar el gasto frecuente:", err);
      setError("No se pudo eliminar. Intenta nuevamente.");
    }
  }

  return (
    <div className="min-h-dvh bg-stone-50 pb-10">
      <header className="flex items-center gap-3 px-5 pt-8">
        <BackButton to="/settings" />
        <div>
          <h1 className="text-xl font-semibold text-stone-900">
            Gastos frecuentes
          </h1>
          <p className="text-sm text-stone-500">
            Rellenan el formulario; tú confirmas el gasto.
          </p>
        </div>
      </header>

      <main className="px-5">
        {!expanded && (
          <button
            type="button"
            onClick={beginCreate}
            disabled={templates.length >= MAX_EXPENSE_TEMPLATES}
            className="mt-6 w-full rounded-xl bg-stone-900 py-3 text-sm font-medium text-white disabled:opacity-40"
          >
            Nuevo gasto frecuente
          </button>
        )}

        {expanded && (
          <section className="mt-6 rounded-2xl border border-stone-200 bg-white p-4">
            <h2 className="font-medium text-stone-900">
              {editingId ? "Editar plantilla" : "Nueva plantilla"}
            </h2>

            <div className="mt-4 grid grid-cols-2 gap-2">
              {(["necesidad", "ocio"] as const).map((category) => (
                <button
                  key={category}
                  type="button"
                  aria-pressed={draft.category === category}
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      category,
                      subcategory: "",
                    }))
                  }
                  className={`rounded-xl border-2 py-2 text-sm font-medium ${
                    draft.category === category
                      ? `${CATEGORY_META[category].selectedBorder} ${CATEGORY_META[category].bg} ${CATEGORY_META[category].text}`
                      : "border-stone-200 text-stone-500"
                  }`}
                >
                  {CATEGORY_META[category].label}
                </button>
              ))}
            </div>

            <label className="mt-4 flex flex-col gap-1 text-sm text-stone-700">
              Subcategoría
              <select
                value={draft.subcategory}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    subcategory: event.target.value,
                  }))
                }
                className="rounded-xl border border-stone-300 bg-white px-3 py-2"
              >
                <option value="">Selecciona</option>
                {availableSubcategories.map((subcategory) => (
                  <option key={subcategory} value={subcategory}>
                    {subcategory}
                  </option>
                ))}
              </select>
            </label>

            <label className="mt-3 flex flex-col gap-1 text-sm text-stone-700">
              Método de pago
              <select
                value={draft.paymentMethod}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    paymentMethod: event.target.value,
                  }))
                }
                className="rounded-xl border border-stone-300 bg-white px-3 py-2"
              >
                <option value="">Selecciona</option>
                {userProfile.paymentMethods.map((method) => (
                  <option key={method.id} value={method.name}>
                    {method.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="mt-3 flex flex-col gap-1 text-sm text-stone-700">
              Monto (opcional)
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                value={draft.amount}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    amount: event.target.value,
                  }))
                }
                placeholder="Lo completarás al usarla"
                className="rounded-xl border border-stone-300 px-3 py-2"
              />
            </label>

            <label className="mt-3 flex flex-col gap-1 text-sm text-stone-700">
              Descripción (opcional)
              <input
                value={draft.description}
                maxLength={200}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                placeholder="Ej. Almuerzo de oficina"
                className="rounded-xl border border-stone-300 px-3 py-2"
              />
            </label>

            <p className="mt-3 text-xs text-stone-400">
              Las plantillas nunca guardan préstamos ni tarjetas de crédito.
            </p>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setExpanded(false)}
                disabled={saving}
                className="flex-1 rounded-xl border border-stone-300 py-2 text-sm text-stone-600"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex-1 rounded-xl bg-teal-600 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </section>
        )}

        <section className="mt-6 space-y-3">
          {templates.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-5 text-center">
              <p className="text-sm text-stone-500">
                Todavía no tienes gastos frecuentes.
              </p>
            </div>
          ) : (
            templates.map((template) => {
              const usable = isExpenseTemplateUsable(
                template,
                userProfile.subcategories,
                userProfile.paymentMethods,
              );
              return (
                <article
                  key={template.id}
                  className="rounded-2xl border border-stone-200 bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-stone-900">
                        {getExpenseTemplateLabel(template)}
                      </p>
                      <p className="mt-1 text-xs text-stone-500">
                        {CATEGORY_META[template.category].label} ·{" "}
                        {template.subcategory} · {template.paymentMethod}
                      </p>
                      <p className="mt-1 text-sm text-stone-700">
                        {template.amountCents
                          ? formatCents(template.amountCents)
                          : "Monto por completar"}
                      </p>
                    </div>
                    {usable ? (
                      <Link
                        to="/expense/new"
                        state={{ templateId: template.id }}
                        className="text-sm font-medium text-teal-600"
                      >
                        Usar
                      </Link>
                    ) : (
                      <span className="text-xs font-medium text-amber-700">
                        Requiere revisión
                      </span>
                    )}
                  </div>
                  {!usable && (
                    <p className="mt-2 text-xs text-amber-700">
                      La subcategoría o el método guardado ya no existe.
                    </p>
                  )}
                  <div className="mt-3 flex gap-4 border-t border-stone-100 pt-3">
                    <button
                      type="button"
                      onClick={() => beginEdit(template)}
                      className="text-xs font-medium text-teal-600"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(template.id)}
                      className="text-xs font-medium text-red-600"
                    >
                      {confirmDeleteId === template.id
                        ? "Confirmar eliminación"
                        : "Eliminar"}
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </section>
      </main>
    </div>
  );
}
