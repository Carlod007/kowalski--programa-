import { useState } from "react";
import type { Source } from "@/types/user";

type Props = {
  data: Source[];
  onChange: (sources: Source[]) => void;
};

export default function Step1Sources({ data, onChange }: Props) {
  const [inputValue, setInputValue] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  function addSource() {
    if (inputValue.trim() === "") return;
    const newSource: Source = {
      id: crypto.randomUUID(),
      name: inputValue.trim(),
    };
    onChange([...data, newSource]);
    setInputValue("");
  }

  function removeSource(id: string) {
    onChange(data.filter((s) => s.id !== id));
  }

  function startEdit(source: Source) {
    setEditingId(source.id);
    setEditValue(source.name);
  }

  function saveEdit() {
    const trimmed = editValue.trim();
    if (trimmed === "") return;
    onChange(
      data.map((s) => (s.id === editingId ? { ...s, name: trimmed } : s)),
    );
    setEditingId(null);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">Fuentes de ingreso</h2>
      <p className="text-xs text-gray-500">
        Agrega tus fuentes. Podrás editarlas después
      </p>
      <p className="text-xs text-gray-400 italic">
        Ejemplos: Sueldo, Freelance, Renta
      </p>

      {/* Lista de fuentes */}
      <div className="flex flex-col gap-2">
        {data.map((source) => (
          <div
            key={source.id}
            className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-3"
          >
            {editingId === source.id ? (
              <div className="flex flex-1 items-center gap-2">
                <input
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveEdit()}
                  autoFocus
                  className="flex-1 rounded-lg border border-gray-300 px-2 py-1 text-sm outline-none"
                />
                <button onClick={saveEdit} className="text-xs font-medium text-teal-600">
                  Guardar
                </button>
                <button onClick={cancelEdit} className="text-xs text-gray-400">
                  Cancelar
                </button>
              </div>
            ) : (
              <>
                <span className="text-sm">{source.name}</span>
                <div className="flex gap-3">
                  <button onClick={() => startEdit(source)} className="text-xs text-teal-600">
                    Editar
                  </button>
                  <button onClick={() => removeSource(source.id)} className="text-xs text-red-400">
                    Eliminar
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Input agregar */}
      <div className="flex gap-2">
        <input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addSource()}
          placeholder="Nueva fuente"
          className="flex-1 rounded-lg bg-gray-50 px-3 py-3 text-sm outline-none"
        />
        <button
          onClick={addSource}
          className="rounded-lg bg-teal-600 px-4 text-sm font-medium text-white"
        >
          + Agregar
        </button>
      </div>
    </div>
  );
}
