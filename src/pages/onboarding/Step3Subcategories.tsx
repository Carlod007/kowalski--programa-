import { useState } from "react";
import type { EssentialNeed } from "@/types/user";
import type { SubcategoryRename } from "@/services/userService";
import { formatCents } from "@/utils/currency";
import { hasDuplicateCatalogName } from "@/utils/masterTables";

type SubcategoryKey = "necesidad" | "ocio";

type Props = {
  data: Record<SubcategoryKey, string[]>;
  essentialNeeds: EssentialNeed[];
  onChange: (
    subcategories: Record<SubcategoryKey, string[]>,
    essentialNeeds: EssentialNeed[],
    renames?: SubcategoryRename[],
  ) => void;
};

type NecesidadRow = {
  id?: string;
  name: string;
  monthlyAmountCents: number;
};

function parseAmountCents(value: string): number {
  const parsed = parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed * 100);
}

function buildNecesidadRows(
  names: string[],
  essentialNeeds: EssentialNeed[],
): NecesidadRow[] {
  const rows: NecesidadRow[] = names.map((name) => {
    const matched = essentialNeeds.find((n) => n.name === name);
    return {
      id: matched?.id,
      name,
      monthlyAmountCents: matched?.monthlyAmountCents ?? 0,
    };
  });
  const linkedNames = new Set(names);
  for (const n of essentialNeeds) {
    if (!linkedNames.has(n.name)) {
      rows.push({
        id: n.id,
        name: n.name,
        monthlyAmountCents: n.monthlyAmountCents,
      });
    }
  }
  return rows;
}

export default function Step3Subcategories({
  data,
  essentialNeeds,
  onChange,
}: Props) {
  const necesidadRows = buildNecesidadRows(data.necesidad, essentialNeeds);

  const [ocioInput, setOcioInput] = useState("");
  const [ocioEditingKey, setOcioEditingKey] = useState<string | null>(null);
  const [ocioEditValue, setOcioEditValue] = useState("");
  const [ocioError, setOcioError] = useState<string | null>(null);

  const [necNameInput, setNecNameInput] = useState("");
  const [necAmountInput, setNecAmountInput] = useState("");
  const [necEditingName, setNecEditingName] = useState<string | null>(null);
  const [necEditName, setNecEditName] = useState("");
  const [necEditAmount, setNecEditAmount] = useState("");
  const [necError, setNecError] = useState<string | null>(null);

  function emitNecesidad(rows: NecesidadRow[], renames?: SubcategoryRename[]) {
    const necesidadNames = rows.map((r) => r.name);
    const newEssentialNeeds: EssentialNeed[] = rows
      .filter((r) => r.monthlyAmountCents > 0)
      .map((r) => ({
        id:
          r.id ??
          essentialNeeds.find((n) => n.name === r.name)?.id ??
          crypto.randomUUID(),
        name: r.name,
        monthlyAmountCents: r.monthlyAmountCents,
      }));
    onChange(
      { ...data, necesidad: necesidadNames },
      newEssentialNeeds,
      renames,
    );
  }

  function addNecesidad() {
    const name = necNameInput.trim();
    if (name === "") return;
    if (
      hasDuplicateCatalogName(
        necesidadRows.map((r) => r.name),
        name,
      )
    ) {
      setNecError("Ya existe una subcategoría con ese nombre en Necesidad.");
      return;
    }
    setNecError(null);
    emitNecesidad([
      ...necesidadRows,
      { name, monthlyAmountCents: parseAmountCents(necAmountInput) },
    ]);
    setNecNameInput("");
    setNecAmountInput("");
  }

  function removeNecesidad(name: string) {
    setNecError(null);
    emitNecesidad(necesidadRows.filter((r) => r.name !== name));
  }

  function startEditNecesidad(row: NecesidadRow) {
    setNecError(null);
    setNecEditingName(row.name);
    setNecEditName(row.name);
    setNecEditAmount(
      row.monthlyAmountCents > 0
        ? (row.monthlyAmountCents / 100).toString()
        : "",
    );
  }

  function saveEditNecesidad() {
    const trimmed = necEditName.trim();
    if (trimmed === "" || !necEditingName) return;
    if (
      hasDuplicateCatalogName(
        necesidadRows.map((r) => r.name),
        trimmed,
        necEditingName,
      )
    ) {
      setNecError("Ya existe una subcategoría con ese nombre en Necesidad.");
      return;
    }
    setNecError(null);
    const renames: SubcategoryRename[] | undefined =
      necEditingName !== trimmed
        ? [{ category: "necesidad", oldName: necEditingName, newName: trimmed }]
        : undefined;
    emitNecesidad(
      necesidadRows.map((r) =>
        r.name === necEditingName
          ? {
              ...r,
              name: trimmed,
              monthlyAmountCents: parseAmountCents(necEditAmount),
            }
          : r,
      ),
      renames,
    );
    setNecEditingName(null);
  }

  function cancelEditNecesidad() {
    setNecError(null);
    setNecEditingName(null);
  }

  function addOcio() {
    const value = ocioInput.trim();
    if (value === "") return;
    if (hasDuplicateCatalogName(data.ocio, value)) {
      setOcioError("Ya existe una subcategoría con ese nombre en Ocio.");
      return;
    }
    setOcioError(null);
    onChange({ ...data, ocio: [...data.ocio, value] }, essentialNeeds);
    setOcioInput("");
  }

  function removeOcio(sub: string) {
    setOcioError(null);
    onChange(
      { ...data, ocio: data.ocio.filter((s) => s !== sub) },
      essentialNeeds,
    );
  }

  function startEditOcio(sub: string) {
    setOcioError(null);
    setOcioEditingKey(sub);
    setOcioEditValue(sub);
  }

  function saveEditOcio(original: string) {
    const trimmed = ocioEditValue.trim();
    if (trimmed === "") return;
    if (hasDuplicateCatalogName(data.ocio, trimmed, original)) {
      setOcioError("Ya existe una subcategoría con ese nombre en Ocio.");
      return;
    }
    setOcioError(null);
    const renames: SubcategoryRename[] | undefined =
      original !== trimmed
        ? [{ category: "ocio", oldName: original, newName: trimmed }]
        : undefined;
    onChange(
      {
        ...data,
        ocio: data.ocio.map((s) => (s === original ? trimmed : s)),
      },
      essentialNeeds,
      renames,
    );
    setOcioEditingKey(null);
  }

  function cancelEditOcio() {
    setOcioError(null);
    setOcioEditingKey(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-medium">Subcategorías</h2>
      <p className="text-xs text-gray-500">
        Define las cajitas dentro de cada grupo. Puedes editarlas después
        desde Ajustes.
      </p>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Necesidad</p>
        <p className="text-xs text-gray-400 italic">
          Si es un gasto fijo mensual (ej. Alquiler), pon el monto - con eso
          calculamos tu % mínimo recomendado. Si es variable (ej. Comida),
          déjalo sin monto.
        </p>

        {necesidadRows.map((row) => (
          <div
            key={row.name}
            className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2"
          >
            {necEditingName === row.name ? (
              <div className="flex flex-1 flex-wrap items-center gap-2">
                <input
                  value={necEditName}
                  onChange={(e) => setNecEditName(e.target.value)}
                  autoFocus
                  className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1 text-sm outline-none"
                />
                <input
                  value={necEditAmount}
                  onChange={(e) => setNecEditAmount(e.target.value)}
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  placeholder="Monto S/ (opcional)"
                  className="w-28 rounded-lg border border-gray-300 px-2 py-1 text-sm outline-none"
                />
                <button
                  onClick={saveEditNecesidad}
                  className="text-xs font-medium text-teal-600"
                >
                  Guardar
                </button>
                <button
                  onClick={cancelEditNecesidad}
                  className="text-xs text-gray-400"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <>
                <div>
                  <span className="text-sm">{row.name}</span>
                  {row.monthlyAmountCents > 0 && (
                    <span className="ml-2 text-xs text-gray-400">
                      {formatCents(row.monthlyAmountCents)}
                    </span>
                  )}
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => startEditNecesidad(row)}
                    className="text-xs text-teal-600"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => removeNecesidad(row.name)}
                    className="text-xs text-red-400"
                  >
                    Eliminar
                  </button>
                </div>
              </>
            )}
          </div>
        ))}

        <div className="flex gap-2">
          <input
            value={necNameInput}
            onChange={(e) => setNecNameInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addNecesidad()}
            placeholder="Nueva subcategoría"
            className="min-w-0 flex-1 rounded-lg bg-gray-50 px-3 py-2 text-sm outline-none"
          />
          <input
            value={necAmountInput}
            onChange={(e) => setNecAmountInput(e.target.value)}
            type="number"
            inputMode="decimal"
            step="0.01"
            placeholder="S/ (opcional)"
            className="w-28 rounded-lg bg-gray-50 px-3 py-2 text-sm outline-none"
          />
          <button
            onClick={addNecesidad}
            className="rounded-lg bg-teal-600 px-4 text-sm font-medium text-white"
          >
            +
          </button>
        </div>
        {necError && <p className="text-xs text-red-500">{necError}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Ocio</p>
        <p className="text-xs text-gray-400 italic">
          Ejemplos: Salidas, Streaming, Hobbies
        </p>

        {data.ocio.map((sub) => (
          <div
            key={sub}
            className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2"
          >
            {ocioEditingKey === sub ? (
              <div className="flex flex-1 items-center gap-2">
                <input
                  value={ocioEditValue}
                  onChange={(e) => setOcioEditValue(e.target.value)}
                  onKeyDown={(e) =>
                    e.key === "Enter" && saveEditOcio(sub)
                  }
                  autoFocus
                  className="flex-1 rounded-lg border border-gray-300 px-2 py-1 text-sm outline-none"
                />
                <button
                  onClick={() => saveEditOcio(sub)}
                  className="text-xs font-medium text-teal-600"
                >
                  Guardar
                </button>
                <button onClick={cancelEditOcio} className="text-xs text-gray-400">
                  Cancelar
                </button>
              </div>
            ) : (
              <>
                <span className="text-sm">{sub}</span>
                <div className="flex gap-3">
                  <button
                    onClick={() => startEditOcio(sub)}
                    className="text-xs text-teal-600"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => removeOcio(sub)}
                    className="text-xs text-red-400"
                  >
                    Eliminar
                  </button>
                </div>
              </>
            )}
          </div>
        ))}

        <div className="flex gap-2">
          <input
            value={ocioInput}
            onChange={(e) => setOcioInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addOcio()}
            placeholder="Nueva subcategoría"
            className="min-w-0 flex-1 rounded-lg bg-gray-50 px-3 py-2 text-sm outline-none"
          />
          <button
            onClick={addOcio}
            className="rounded-lg bg-teal-600 px-4 text-sm font-medium text-white"
          >
            +
          </button>
        </div>
        {ocioError && <p className="text-xs text-red-500">{ocioError}</p>}
      </div>
    </div>
  );
}
