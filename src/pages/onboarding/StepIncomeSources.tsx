import { useState } from "react";
import type { Source, FixedIncome } from "@/types/user";
import { formatCents } from "@/utils/currency";

type Props = {
  sources: Source[];
  fixedIncomes: FixedIncome[];
  onChange: (sources: Source[], fixedIncomes: FixedIncome[]) => void;
};

type IncomeRow = {
  id: string;
  name: string;
  isFixed: boolean;
  monthlyAmountCents: number;
};

function buildRows(sources: Source[], fixedIncomes: FixedIncome[]): IncomeRow[] {
  const rows: IncomeRow[] = sources.map((s) => {
    const fixed = fixedIncomes.find((f) => f.id === s.id);
    return {
      id: s.id,
      name: s.name,
      isFixed: !!fixed,
      monthlyAmountCents: fixed?.monthlyAmountCents ?? 0,
    };
  });
  const linkedIds = new Set(sources.map((s) => s.id));
  for (const f of fixedIncomes) {
    if (!linkedIds.has(f.id)) {
      rows.push({
        id: f.id,
        name: f.name,
        isFixed: true,
        monthlyAmountCents: f.monthlyAmountCents,
      });
    }
  }
  return rows;
}

function emitChange(rows: IncomeRow[], onChange: Props["onChange"]) {
  const sources: Source[] = rows.map((r) => ({ id: r.id, name: r.name }));
  const fixedIncomes: FixedIncome[] = rows
    .filter((r) => r.isFixed && r.monthlyAmountCents > 0)
    .map((r) => ({
      id: r.id,
      name: r.name,
      monthlyAmountCents: r.monthlyAmountCents,
    }));
  onChange(sources, fixedIncomes);
}

function parseAmountCents(value: string): number {
  const parsed = parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed * 100);
}

export default function StepIncomeSources({
  sources,
  fixedIncomes,
  onChange,
}: Props) {
  const rows = buildRows(sources, fixedIncomes);

  const [nameInput, setNameInput] = useState("");
  const [isFixedInput, setIsFixedInput] = useState(false);
  const [amountInput, setAmountInput] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editIsFixed, setEditIsFixed] = useState(false);
  const [editAmount, setEditAmount] = useState("");

  function addRow() {
    if (nameInput.trim() === "") return;
    const newRow: IncomeRow = {
      id: crypto.randomUUID(),
      name: nameInput.trim(),
      isFixed: isFixedInput,
      monthlyAmountCents: parseAmountCents(amountInput),
    };
    emitChange([...rows, newRow], onChange);
    setNameInput("");
    setIsFixedInput(false);
    setAmountInput("");
  }

  function removeRow(id: string) {
    emitChange(
      rows.filter((r) => r.id !== id),
      onChange,
    );
  }

  function startEdit(row: IncomeRow) {
    setEditingId(row.id);
    setEditName(row.name);
    setEditIsFixed(row.isFixed);
    setEditAmount(
      row.monthlyAmountCents > 0
        ? (row.monthlyAmountCents / 100).toString()
        : "",
    );
  }

  function saveEdit() {
    const trimmed = editName.trim();
    if (trimmed === "") return;
    emitChange(
      rows.map((r) =>
        r.id === editingId
          ? {
              ...r,
              name: trimmed,
              isFixed: editIsFixed,
              monthlyAmountCents: editIsFixed
                ? parseAmountCents(editAmount)
                : 0,
            }
          : r,
      ),
      onChange,
    );
    setEditingId(null);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">Ingresos</h2>
      <p className="text-xs text-gray-500">
        Agrega tus fuentes de ingreso. Si alguna es fija todos los meses
        (sueldo, pensión), márcala como fija e indica cuánto - con eso
        calculamos el % mínimo recomendado de Necesidad.
      </p>
      <p className="text-xs text-gray-400 italic">
        Ejemplos: Sueldo (fijo, S/ 2500) · Freelance (no fijo)
      </p>

      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <div
            key={row.id}
            className="flex flex-col gap-2 rounded-lg bg-gray-50 px-3 py-3"
          >
            {editingId === row.id ? (
              <div className="flex flex-col gap-2">
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  autoFocus
                  className="rounded-lg border border-gray-300 px-2 py-1 text-sm outline-none"
                />
                <label className="flex items-center gap-2 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={editIsFixed}
                    onChange={(e) => setEditIsFixed(e.target.checked)}
                  />
                  Es un ingreso fijo
                </label>
                {editIsFixed && (
                  <input
                    value={editAmount}
                    onChange={(e) => setEditAmount(e.target.value)}
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    placeholder="Monto mensual S/"
                    className="rounded-lg border border-gray-300 px-2 py-1 text-sm outline-none"
                  />
                )}
                <div className="flex gap-3">
                  <button
                    onClick={saveEdit}
                    className="text-xs font-medium text-teal-600"
                  >
                    Guardar
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="text-xs text-gray-400"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm">{row.name}</span>
                  {row.isFixed && (
                    <span className="ml-2 text-xs text-gray-400">
                      Fijo · {formatCents(row.monthlyAmountCents)}
                    </span>
                  )}
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => startEdit(row)}
                    className="text-xs text-teal-600"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => removeRow(row.id)}
                    className="text-xs text-red-400"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-dashed border-gray-300 p-3">
        <input
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !isFixedInput && addRow()}
          placeholder="Nueva fuente"
          className="rounded-lg bg-gray-50 px-3 py-2 text-sm outline-none"
        />
        <label className="flex items-center gap-2 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={isFixedInput}
            onChange={(e) => setIsFixedInput(e.target.checked)}
          />
          Es un ingreso fijo
        </label>
        {isFixedInput && (
          <input
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            type="number"
            inputMode="decimal"
            step="0.01"
            placeholder="Monto mensual S/"
            className="rounded-lg bg-gray-50 px-3 py-2 text-sm outline-none"
          />
        )}
        <button
          onClick={addRow}
          className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white"
        >
          + Agregar
        </button>
      </div>
    </div>
  );
}
