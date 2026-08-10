import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";
import {
  assignToGoal,
  getGoalAllocations,
  unassignFromGoal,
  type GoalAllocationWithId,
} from "@/services/savingsGoalService";
import { formatCents } from "@/utils/currency";
import {
  getAssignableCents,
  getGoalProgress,
  getUnassignedCents,
  wasPurchased,
} from "@/utils/savings";
import { formatDateLabel } from "@/utils/date";
import type { SavingsGoal } from "@/types/user";
import BackButton from "@/components/BackButton";
import CategoryIcon from "@/components/CategoryIcon";

export default function SavingsGoals() {
  const user = useAuthStore((s) => s.user);
  const userProfile = useAuthStore((s) => s.userProfile);

  if (!user || !userProfile) return null;

  const goals = userProfile.savingsGoals ?? [];
  const savingsTotalCents = userProfile.savingsTotalCents ?? 0;
  const unassignedCents = getUnassignedCents(savingsTotalCents, goals);
  const assignableCents = getAssignableCents(savingsTotalCents, goals);
  const overAllocated = unassignedCents < 0;

  return (
    <div className="min-h-dvh bg-stone-50 px-5 pt-8 pb-10">
      <div className="flex items-center gap-3">
        <BackButton to="/dashboard" />
        <h1 className="text-xl font-semibold text-stone-900">
          Metas de ahorro
        </h1>
      </div>

      <div className="mt-5 rounded-2xl border border-stone-200 bg-white p-4">
        <div className="flex items-center gap-3">
          <CategoryIcon category="ahorro" />
          <div>
            <p className="text-xs text-stone-400">Sin asignar</p>
            <p className="text-2xl font-semibold text-teal-700">
              {formatCents(assignableCents)}
            </p>
          </div>
        </div>
        <p className="mt-3 border-t border-stone-100 pt-3 text-xs text-stone-400">
          Ahorro total: {formatCents(savingsTotalCents)}
        </p>
        {/* Aclara la diferencia con "aportado este mes", que es la otra forma
            de mirar el ahorro y vive en Ver detalle. Sin esto, los dos números
            parecen contradecirse. */}
        <p className="mt-2 text-xs text-stone-400">
          Asignar reparte tu acumulado de todos los meses, no lo que entró
          este mes.{" "}
          <Link to="/movements" className="font-medium text-teal-600">
            Ver el movimiento del mes →
          </Link>
        </p>
      </div>

      {overAllocated && (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2">
          <p className="text-xs text-amber-800">
            Tus metas tienen {formatCents(-unassignedCents)} asignados de más.
            Suele pasar cuando se corrige o borra un ingreso ya registrado.
            Libera ese monto de alguna meta para volver a cuadrar.
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3">
        {goals.length === 0 ? (
          <div className="rounded-2xl border border-stone-200 bg-white p-6 text-center">
            <p className="text-sm text-stone-500">
              Todavía no tienes metas de ahorro.
            </p>
            <Link
              to="/settings"
              className="mt-2 inline-block text-xs font-medium text-teal-600"
            >
              Crear una en Ajustes →
            </Link>
          </div>
        ) : (
          goals.map((goal) => (
            <GoalCard
              key={goal.id}
              userId={user.uid}
              goal={goal}
              assignableCents={assignableCents}
            />
          ))
        )}
      </div>

      <AllocationHistory userId={user.uid} />
    </div>
  );
}

const HISTORY_LIMIT = 15;

function AllocationHistory({ userId }: { userId: string }) {
  // null = no se pudo leer. Distinto de [] = se leyó y no hay nada.
  const [allocations, setAllocations] = useState<GoalAllocationWithId[] | null>(
    [],
  );
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const unsubscribe = getGoalAllocations(userId, HISTORY_LIMIT, setAllocations);
    return () => unsubscribe();
  }, [userId]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 flex w-full items-center justify-between rounded-2xl border border-stone-200 bg-white px-4 py-3 text-left"
      >
        <span className="text-sm font-medium text-stone-900">
          Historial de asignaciones
        </span>
        <span className="text-xs font-medium text-teal-600">Ver →</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-5 pb-5 sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-stone-900">
                Historial de asignaciones
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                className="flex h-6 w-6 items-center justify-center rounded-full bg-stone-100 text-stone-500"
              >
                ✕
              </button>
            </div>

            {allocations === null ? (
              <p className="mt-3 text-sm text-amber-700">
                No se pudo cargar el historial. Tus metas y montos no se ven
                afectados.
              </p>
            ) : allocations.length === 0 ? (
              <p className="mt-3 text-sm text-stone-400">
                Todavía no has asignado ni liberado dinero. Cuando lo hagas,
                cada movimiento queda registrado aquí.
              </p>
            ) : (
              <div className="mt-3 flex flex-col gap-2">
                {allocations.map((a) => {
                  const isAssign = a.direction === "assign";
                  return (
                    <div
                      key={a._id}
                      className="flex items-center justify-between rounded-xl border border-stone-200 bg-white px-3 py-2"
                    >
                      <div>
                        <p className="text-sm text-stone-900">{a.goalName}</p>
                        <p className="text-xs text-stone-400">
                          {isAssign ? "Asignado" : "Liberado"} ·{" "}
                          {formatDateLabel(a.transactionDate)}
                        </p>
                      </div>
                      <span
                        className={`text-sm font-medium ${
                          isAssign ? "text-teal-700" : "text-stone-500"
                        }`}
                      >
                        {isAssign ? "+" : "-"}
                        {formatCents(a.amountCents)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            <p className="mt-3 text-xs text-stone-400">
              Solo asignaciones y liberaciones. Las compras de metas y los
              retiros de fondos quedan en el historial de egresos.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

type PanelMode = "assign" | "unassign";

function GoalCard({
  userId,
  goal,
  assignableCents,
}: {
  userId: string;
  goal: SavingsGoal;
  assignableCents: number;
}) {
  const [mode, setMode] = useState<PanelMode | null>(null);
  const progress = getGoalProgress(goal);

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-stone-900">{goal.name}</p>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              progress.kind === "fondo"
                ? "bg-teal-50 text-teal-700"
                : "bg-stone-100 text-stone-500"
            }`}
          >
            {progress.kind === "fondo" ? "Fondo" : "Compra"}
          </span>
        </div>
        {progress.isComplete && (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
            Completa
          </span>
        )}
      </div>

      {wasPurchased(goal) && (
        <p className="mt-1 text-xs text-emerald-700">
          Ya adquirida
          {goal.lastPurchasedAt
            ? ` el ${formatDateLabel(goal.lastPurchasedAt)}`
            : ""}
          . Puedes volver a juntar para comprarla de nuevo.
        </p>
      )}

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-stone-200">
        <div
          className="h-full rounded-full bg-teal-500"
          style={{ width: `${progress.barWidth}%` }}
        />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-3 rounded-xl bg-stone-50 p-3 text-xs">
        <div>
          <p className="text-stone-400">Asignado</p>
          <p className="mt-0.5 font-medium text-stone-900">
            {formatCents(progress.allocatedCents)}
          </p>
          <p className="text-stone-400">de {formatCents(progress.targetCents)}</p>
        </div>
        <div>
          <p className="text-stone-400">
            {progress.isComplete ? "Estado" : "Falta"}
          </p>
          <p className="mt-0.5 font-medium text-stone-900">
            {progress.isComplete
              ? progress.kind === "fondo"
                ? "Objetivo cubierto"
                : "Lista para usar"
              : formatCents(progress.missingCents)}
          </p>
          {progress.kind === "fondo" && !progress.isComplete && (
            <p className="text-stone-400">Igual puedes usarla</p>
          )}
        </div>
      </div>

      {/* El atajo solo aparece en metas de compra completas. Un fondo no se
          "termina": llegar al objetivo significa estar cubierto, no que sea
          hora de gastarlo. Empujar a usarlo ahí iría contra su propósito. */}
      {progress.canPurchase && (
        <Link
          to="/expense/new"
          state={{ goalId: goal.id }}
          className="mt-3 block rounded-xl bg-teal-600 py-2 text-center text-xs font-medium text-white"
        >
          Comprar ahora →
        </Link>
      )}

      {mode === null ? (
        <div className="mt-2 flex gap-4">
          <button
            type="button"
            onClick={() => setMode("assign")}
            disabled={assignableCents <= 0}
            className="text-xs font-medium text-teal-600 disabled:text-stone-300"
          >
            Asignar →
          </button>
          {progress.allocatedCents > 0 && (
            <button
              type="button"
              onClick={() => setMode("unassign")}
              className="text-xs font-medium text-stone-500"
            >
              Liberar →
            </button>
          )}
        </div>
      ) : (
        <AllocationPanel
          userId={userId}
          goal={goal}
          mode={mode}
          maxCents={
            mode === "assign" ? assignableCents : progress.allocatedCents
          }
          onClose={() => setMode(null)}
        />
      )}
    </div>
  );
}

function AllocationPanel({
  userId,
  goal,
  mode,
  maxCents,
  onClose,
}: {
  userId: string;
  goal: SavingsGoal;
  mode: PanelMode;
  maxCents: number;
  onClose: () => void;
}) {
  const [amountInput, setAmountInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = parseFloat(amountInput);
  const amountCents =
    Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : 0;
  const exceedsMax = amountCents > maxCents;

  const progress = getGoalProgress(goal);
  // Solo sugerimos completar cuando de verdad alcanza: ofrecer un atajo que
  // después falla sería peor que no ofrecerlo.
  const suggestCents =
    mode === "assign" && progress.missingCents > 0
      ? Math.min(progress.missingCents, maxCents)
      : 0;

  async function handleConfirm() {
    if (amountCents <= 0) {
      setError("Ingresa un monto mayor a 0");
      return;
    }
    if (exceedsMax) {
      setError("El monto supera el disponible");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (mode === "assign") {
        await assignToGoal(userId, goal.id, amountCents);
      } else {
        await unassignFromGoal(userId, goal.id, amountCents);
      }
      onClose();
    } catch (err) {
      console.error("Error al ajustar la meta:", err);
      setError(
        err instanceof Error ? err.message : "No se pudo ajustar la meta",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl bg-sky-50 p-3">
      <p className="text-sm font-medium text-teal-700">
        {mode === "assign" ? "Asignar a esta meta" : "Liberar de esta meta"}
      </p>

      <input
        value={amountInput}
        onChange={(e) => setAmountInput(e.target.value)}
        type="number"
        inputMode="decimal"
        step="0.01"
        placeholder="Monto S/"
        className="mt-2 w-full rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm outline-none"
      />

      <div className="mt-2 flex flex-wrap gap-3">
        {suggestCents > 0 && (
          <button
            type="button"
            onClick={() => setAmountInput((suggestCents / 100).toString())}
            className="text-xs font-medium text-teal-600"
          >
            Completar ({formatCents(suggestCents)})
          </button>
        )}
        {maxCents > 0 && (
          <button
            type="button"
            onClick={() => setAmountInput((maxCents / 100).toString())}
            className="text-xs font-medium text-teal-600"
          >
            Todo ({formatCents(maxCents)})
          </button>
        )}
      </div>

      {exceedsMax && (
        <p className="mt-2 text-xs text-red-500">
          Máximo disponible: {formatCents(maxCents)}
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="flex-1 rounded-lg border border-stone-300 py-1.5 text-xs text-stone-600"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={saving || amountCents <= 0 || exceedsMax}
          className="flex-1 rounded-lg bg-teal-600 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {saving ? "Guardando..." : "Confirmar"}
        </button>
      </div>
    </div>
  );
}
