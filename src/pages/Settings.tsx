import { useState } from "react";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuthStore } from "@/store/authStore";
import { updateUserProfile } from "@/services/userService";
import StepIncomeSources from "@/pages/onboarding/StepIncomeSources";
import Step2Distribution from "@/pages/onboarding/Step2Distribution";
import Step3Subcategories from "@/pages/onboarding/Step3Subcategories";
import Step4PaymentMethods from "@/pages/onboarding/Step4PaymentMethods";
import { updateDistributionNow } from "@/services/monthService";
import { calculateMinimumNecesidadPercentage } from "@/utils/distribution";
import type {
  Source,
  PaymentMethod,
  SavingsGoal,
  FixedIncome,
  EssentialNeed,
} from "@/types/user";
import type { Distribution } from "@/types/transaction";
import { formatCents } from "@/utils/currency";
import BackButton from "@/components/BackButton";
import { Link } from "react-router-dom";

function ProfileSection() {
  const { user, userProfile, setUserProfile } = useAuthStore();
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(userProfile?.name ?? "");
  const [saving, setSaving] = useState(false);

  if (!user || !userProfile) return null;

  const currentUser = user;
  const currentProfile = userProfile;

  async function handleSaveName() {
    const trimmed = nameInput.trim();
    if (trimmed === "" || trimmed === currentProfile.name) {
      setEditingName(false);
      return;
    }
    setSaving(true);
    try {
      await updateUserProfile(currentUser.uid, { name: trimmed });
      setUserProfile({ ...currentProfile, name: trimmed });
      setEditingName(false);
    } catch (err) {
      console.error("Error al actualizar nombre:", err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mx-5 mt-6">
      <h2 className="text-xs font-medium uppercase tracking-wide text-stone-400">
        Perfil
      </h2>
      <div className="mt-2 divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm text-stone-900">Nombre</span>
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSaveName()}
                disabled={saving}
                autoFocus
                className="w-32 rounded-lg border border-stone-300 px-2 py-1 text-sm outline-none"
              />
              <button
                type="button"
                onClick={handleSaveName}
                disabled={saving}
                className="text-xs font-medium text-teal-600"
              >
                Guardar
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setNameInput(userProfile.name);
                setEditingName(true);
              }}
              className="text-sm text-stone-500"
            >
              {userProfile.name}
            </button>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm text-stone-900">Correo</span>
          <span className="text-sm text-stone-400">{userProfile.email}</span>
        </div>

        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm text-stone-900">Contraseña</span>
          <span className="text-sm tracking-widest text-stone-400">
            ••••••••
          </span>
        </div>
      </div>
    </section>
  );
}

function DistributionSection() {
  const { user, userProfile, setUserProfile } = useAuthStore();
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<Distribution | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acknowledgedDeficitKey, setAcknowledgedDeficitKey] = useState<
    string | null
  >(null);

  const [showConfirm, setShowConfirm] = useState(false);

  if (!user || !userProfile) return null;

  const currentUser = user;
  const currentProfile = userProfile;

  const fixedIncomesTotalCents = (currentProfile.fixedIncomes ?? []).reduce(
    (sum, i) => sum + i.monthlyAmountCents,
    0,
  );
  const essentialNeedsTotalCents = (currentProfile.essentialNeeds ?? []).reduce(
    (sum, n) => sum + n.monthlyAmountCents,
    0,
  );
  const minNecesidad = calculateMinimumNecesidadPercentage(
    fixedIncomesTotalCents,
    essentialNeedsTotalCents,
  );
  const hasDeficit = minNecesidad > 100;
  // Atar el "aceptado" a los totales actuales: si cambian (ej. editando
  // Ingresos fijos en otra sección abierta), la clave deja de coincidir.
  const deficitKey = `${fixedIncomesTotalCents}:${essentialNeedsTotalCents}`;
  const deficitAcknowledged = acknowledgedDeficitKey === deficitKey;

  function handleExpand() {
    setDraft(currentProfile.distribution);
    setError(null);
    setAcknowledgedDeficitKey(null);
    setExpanded(true);
  }

  function handleCancel() {
    setDraft(null);
    setError(null);
    setAcknowledgedDeficitKey(null);
    setExpanded(false);
  }

  function handleSave() {
    if (!draft) return;
    const sum = draft.necesidad + draft.ocio + draft.ahorro;
    if (sum !== 100) {
      setError("Los porcentajes deben sumar 100%");
      return;
    }
    if (hasDeficit && !deficitAcknowledged) {
      setError("Marca \"Continuar con déficit\" para guardar de todas formas");
      return;
    }
    if (!hasDeficit && draft.necesidad < minNecesidad) {
      setError(
        `Según tus ingresos y necesidades declaradas, Necesidad debería ser al menos ${minNecesidad}%`,
      );
      return;
    }
    setError(null);
    setShowConfirm(true);
  }

  async function confirmSave() {
    if (!draft) return;
    setShowConfirm(false);
    setSaving(true);
    try {
      await updateDistributionNow(currentUser.uid, draft);
      setUserProfile({ ...currentProfile, distribution: draft });
      setDraft(null);
      setExpanded(false);
    } catch (err) {
      console.error("Error al actualizar distribución:", err);
      setError("No se pudo guardar. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  const { necesidad, ocio, ahorro } = currentProfile.distribution;

  return (
    <div>
      {!expanded ? (
        <button
          type="button"
          onClick={handleExpand}
          className="flex w-full items-center justify-between px-4 py-3"
        >
          <span className="text-sm text-stone-900">Distribución</span>
          <span className="text-sm text-stone-400">
            {necesidad}/{ocio}/{ahorro}
          </span>
        </button>
      ) : (
        <div className="p-4">
          <Step2Distribution
            data={draft!}
            onChange={setDraft}
            minNecesidad={hasDeficit ? undefined : minNecesidad}
          />
          {hasDeficit && (
            <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm text-amber-800">
                Tus necesidades ({formatCents(essentialNeedsTotalCents)})
                superan tus ingresos fijos ({formatCents(fixedIncomesTotalCents)}
                ) en{" "}
                {formatCents(essentialNeedsTotalCents - fixedIncomesTotalCents)}
                . Ningún reparto puede cubrir esto sin corregir esos datos.
              </p>
              <label className="mt-2 flex items-center gap-2 text-sm text-amber-800">
                <input
                  type="checkbox"
                  checked={deficitAcknowledged}
                  onChange={(e) =>
                    setAcknowledgedDeficitKey(
                      e.target.checked ? deficitKey : null,
                    )
                  }
                />
                Continuar con déficit
              </label>
            </div>
          )}
          {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={saving}
              className="flex-1 rounded-lg border border-stone-300 py-2 text-sm text-stone-600"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex-1 rounded-lg bg-teal-600 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "Guardando..." : "Guardar cambios"}
            </button>
          </div>
        </div>
      )}

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5">
            <p className="text-sm text-stone-900">
              El nuevo reparto se aplicará desde el próximo mes. Este mes sigue
              con la distribución actual.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className="flex-1 rounded-lg border border-stone-300 py-2 text-sm text-stone-600"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmSave}
                className="flex-1 rounded-lg bg-teal-600 py-2 text-sm font-medium text-white"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function IncomeSourcesSection() {
  const { user, userProfile, setUserProfile } = useAuthStore();
  const [expanded, setExpanded] = useState(false);
  const [sourcesDraft, setSourcesDraft] = useState<Source[] | null>(null);
  const [fixedIncomesDraft, setFixedIncomesDraft] = useState<
    FixedIncome[] | null
  >(null);
  const [saving, setSaving] = useState(false);

  if (!user || !userProfile) return null;
  const currentUser = user;
  const currentProfile = userProfile;

  function handleExpand() {
    setSourcesDraft(currentProfile.sources);
    setFixedIncomesDraft(currentProfile.fixedIncomes ?? []);
    setExpanded(true);
  }
  function handleCancel() {
    setSourcesDraft(null);
    setFixedIncomesDraft(null);
    setExpanded(false);
  }
  async function handleSave() {
    if (!sourcesDraft || !fixedIncomesDraft) return;
    setSaving(true);
    try {
      await updateUserProfile(currentUser.uid, {
        sources: sourcesDraft,
        fixedIncomes: fixedIncomesDraft,
      });
      setUserProfile({
        ...currentProfile,
        sources: sourcesDraft,
        fixedIncomes: fixedIncomesDraft,
      });
      setSourcesDraft(null);
      setFixedIncomesDraft(null);
      setExpanded(false);
    } catch (err) {
      console.error("Error al actualizar ingresos:", err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {!expanded ? (
        <button
          type="button"
          onClick={handleExpand}
          className="flex w-full items-center justify-between px-4 py-3"
        >
          <span className="text-sm text-stone-900">Ingresos</span>
          <span className="text-sm text-stone-400">
            {currentProfile.sources.length}
          </span>
        </button>
      ) : (
        <div className="p-4">
          <StepIncomeSources
            sources={sourcesDraft!}
            fixedIncomes={fixedIncomesDraft!}
            onChange={(sources, fixedIncomes) => {
              setSourcesDraft(sources);
              setFixedIncomesDraft(fixedIncomes);
            }}
          />
          <p className="mt-2 text-xs text-stone-400">
            El monto fijo solo actualiza el % mínimo de Necesidad sugerido. No
            cambia el mes en curso.
          </p>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={saving}
              className="flex-1 rounded-lg border border-stone-300 py-2 text-sm text-stone-600"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex-1 rounded-lg bg-teal-600 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "Guardando..." : "Guardar cambios"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SubcategoriesSection() {
  const { user, userProfile, setUserProfile } = useAuthStore();
  const [expanded, setExpanded] = useState(false);
  const [subcategoriesDraft, setSubcategoriesDraft] = useState<Record<
    "necesidad" | "ocio",
    string[]
  > | null>(null);
  const [essentialNeedsDraft, setEssentialNeedsDraft] = useState<
    EssentialNeed[] | null
  >(null);
  const [saving, setSaving] = useState(false);

  if (!user || !userProfile) return null;
  const currentUser = user;
  const currentProfile = userProfile;

  const totalCount =
    currentProfile.subcategories.necesidad.length +
    currentProfile.subcategories.ocio.length;

  function handleExpand() {
    setSubcategoriesDraft(currentProfile.subcategories);
    setEssentialNeedsDraft(currentProfile.essentialNeeds ?? []);
    setExpanded(true);
  }
  function handleCancel() {
    setSubcategoriesDraft(null);
    setEssentialNeedsDraft(null);
    setExpanded(false);
  }
  async function handleSave() {
    if (!subcategoriesDraft || !essentialNeedsDraft) return;
    setSaving(true);
    try {
      await updateUserProfile(currentUser.uid, {
        subcategories: subcategoriesDraft,
        essentialNeeds: essentialNeedsDraft,
      });
      setUserProfile({
        ...currentProfile,
        subcategories: subcategoriesDraft,
        essentialNeeds: essentialNeedsDraft,
      });
      setSubcategoriesDraft(null);
      setEssentialNeedsDraft(null);
      setExpanded(false);
    } catch (err) {
      console.error("Error al actualizar subcategorías:", err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {!expanded ? (
        <button
          type="button"
          onClick={handleExpand}
          className="flex w-full items-center justify-between px-4 py-3"
        >
          <span className="text-sm text-stone-900">Subcategorías</span>
          <span className="text-sm text-stone-400">{totalCount}</span>
        </button>
      ) : (
        <div className="p-4">
          <Step3Subcategories
            data={subcategoriesDraft!}
            essentialNeeds={essentialNeedsDraft!}
            onChange={(subcategories, essentialNeeds) => {
              setSubcategoriesDraft(subcategories);
              setEssentialNeedsDraft(essentialNeeds);
            }}
          />
          <p className="mt-2 text-xs text-stone-400">
            El monto en Necesidad solo actualiza el % mínimo sugerido. No
            cambia el mes en curso.
          </p>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={saving}
              className="flex-1 rounded-lg border border-stone-300 py-2 text-sm text-stone-600"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex-1 rounded-lg bg-teal-600 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "Guardando..." : "Guardar cambios"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PaymentMethodsSection() {
  const { user, userProfile, setUserProfile } = useAuthStore();
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<PaymentMethod[] | null>(null);
  const [saving, setSaving] = useState(false);

  if (!user || !userProfile) return null;
  const currentUser = user;
  const currentProfile = userProfile;

  function handleExpand() {
    setDraft(currentProfile.paymentMethods);
    setExpanded(true);
  }
  function handleCancel() {
    setDraft(null);
    setExpanded(false);
  }
  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    try {
      await updateUserProfile(currentUser.uid, { paymentMethods: draft });
      setUserProfile({ ...currentProfile, paymentMethods: draft });
      setDraft(null);
      setExpanded(false);
    } catch (err) {
      console.error("Error al actualizar métodos de pago:", err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {!expanded ? (
        <button
          type="button"
          onClick={handleExpand}
          className="flex w-full items-center justify-between px-4 py-3"
        >
          <span className="text-sm text-stone-900">Métodos de pago</span>
          <span className="text-sm text-stone-400">
            {currentProfile.paymentMethods.length}
          </span>
        </button>
      ) : (
        <div className="p-4">
          <Step4PaymentMethods data={draft!} onChange={setDraft} />
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={saving}
              className="flex-1 rounded-lg border border-stone-300 py-2 text-sm text-stone-600"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex-1 rounded-lg bg-teal-600 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "Guardando..." : "Guardar cambios"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SavingsGoalsSection() {
  const { user, userProfile, setUserProfile } = useAuthStore();
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<SavingsGoal[] | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [costInput, setCostInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [goalError, setGoalError] = useState<string | null>(null);

  if (!user || !userProfile) return null;
  const currentUser = user;
  const currentProfile = userProfile;

  function handleExpand() {
    setDraft(currentProfile.savingsGoals ?? []);
    setExpanded(true);
  }
  function handleCancel() {
    setDraft(null);
    setNameInput("");
    setCostInput("");
    setGoalError(null);
    setExpanded(false);
  }
  function handleAddGoal() {
    const name = nameInput.trim();
    const cost = parseFloat(costInput);
    if (!draft) return;
    if (!name && (!costInput || !Number.isFinite(cost) || cost <= 0)) {
      setGoalError("Falta el nombre y el costo de la meta");
      return;
    }
    if (!name) {
      setGoalError("Falta el nombre de la meta");
      return;
    }
    if (!costInput || !Number.isFinite(cost) || cost <= 0) {
      setGoalError("El costo debe ser mayor a 0");
      return;
    }
    setGoalError(null);
    const goal: SavingsGoal = {
      id: crypto.randomUUID(),
      name,
      targetCents: Math.round(cost * 100),
      createdAt: null,
    };
    setDraft([...draft, goal]);
    setNameInput("");
    setCostInput("");
  }
  function handleRemoveGoal(id: string) {
    if (!draft) return;
    setDraft(draft.filter((g) => g.id !== id));
  }
  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    try {
      await updateUserProfile(currentUser.uid, { savingsGoals: draft });
      setUserProfile({ ...currentProfile, savingsGoals: draft });
      setDraft(null);
      setExpanded(false);
    } catch (err) {
      console.error("Error al actualizar metas:", err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {!expanded ? (
        <button
          type="button"
          onClick={handleExpand}
          className="flex w-full items-center justify-between px-4 py-3"
        >
          <span className="text-sm text-stone-900">Metas de ahorro</span>
          <span className="text-sm text-stone-400">
            {(currentProfile.savingsGoals ?? []).length}
          </span>
        </button>
      ) : (
        <div className="p-4">
          <p className="text-xs text-stone-500">
            Ahorro acumulado: {formatCents(currentProfile.savingsTotalCents ?? 0)}
          </p>

          <div className="mt-3 flex flex-col gap-2">
            {draft!.map((goal) => (
              <div
                key={goal.id}
                className="flex items-center justify-between rounded-lg border border-stone-200 px-3 py-2"
              >
                <div>
                  <p className="text-sm text-stone-900">{goal.name}</p>
                  <p className="text-xs text-stone-400">
                    {formatCents(goal.targetCents)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveGoal(goal.id)}
                  className="text-xs font-medium text-red-600"
                >
                  Quitar
                </button>
              </div>
            ))}
          </div>

          {goalError && (
            <p className="mt-3 text-xs text-red-500">{goalError}</p>
          )}
          <div className="mt-3 flex gap-2">
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Nombre (ej. Guitarra)"
              className="min-w-0 flex-1 rounded-lg border border-stone-300 px-2 py-1.5 text-sm outline-none"
            />
            <input
              value={costInput}
              onChange={(e) => setCostInput(e.target.value)}
              type="number"
              inputMode="decimal"
              step="0.01"
              placeholder="Costo S/"
              className="w-24 rounded-lg border border-stone-300 px-2 py-1.5 text-sm outline-none"
            />
            <button
              type="button"
              onClick={handleAddGoal}
              className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white"
            >
              +
            </button>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={saving}
              className="flex-1 rounded-lg border border-stone-300 py-2 text-sm text-stone-600"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex-1 rounded-lg bg-teal-600 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "Guardando..." : "Guardar cambios"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const ADMIN_UID = import.meta.env.VITE_ADMIN_UID;

export default function Settings() {
  const { user } = useAuthStore();
  const [loggingOut, setLoggingOut] = useState(false);
  const isAdmin = !!ADMIN_UID && user?.uid === ADMIN_UID;

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await signOut(auth);
    } catch (err) {
      console.error("Error al cerrar sesión:", err);
      setLoggingOut(false);
    }
  }

  return (
    <div className="min-h-dvh bg-stone-50 pb-8">
      <header className="flex items-center gap-3 px-5 pt-8">
        <BackButton to="/dashboard" />
        <h1 className="text-xl font-semibold text-stone-900">Configuración</h1>
      </header>

      <ProfileSection />

      <section className="mx-5 mt-6">
        <h2 className="text-xs font-medium uppercase tracking-wide text-stone-400">
          Finanzas
        </h2>
        <div className="mt-2 divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white overflow-hidden">
          <DistributionSection />
          <IncomeSourcesSection />
          <SubcategoriesSection />
          <PaymentMethodsSection />
          <SavingsGoalsSection />
          {isAdmin && (
            <Link
              to="/admin"
              className="flex w-full items-center justify-between px-4 py-3"
            >
              <span className="text-sm text-stone-900">
                Panel de administrador
              </span>
              <span className="text-sm text-stone-400">›</span>
            </Link>
          )}
          <Link
            to="/close-month"
            className="flex w-full items-center justify-between px-4 py-3"
          >
            <span className="text-sm text-stone-900">
              Resumen de cierre de mes
            </span>
            <span className="text-sm text-stone-400">›</span>
          </Link>
        </div>
      </section>

      <div className="mt-8 px-5">
        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="w-full rounded-2xl border border-red-200 bg-red-50 py-3 text-sm font-medium text-red-600 disabled:opacity-40"
        >
          {loggingOut ? "Cerrando sesión..." : "Cerrar sesión"}
        </button>
      </div>
    </div>
  );
}
