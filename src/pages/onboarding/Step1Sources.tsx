import { useState } from "react";
import type { Source } from "@/types/user";

type Props = {
  data: Source[];
  onChange: (sources: Source[]) => void;
};

export default function Step1Sources({ data, onChange }: Props) {
  const [inputValue, setInputValue] = useState("");

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
            <span className="text-sm">{source.name}</span>
            <button
              onClick={() => removeSource(source.id)}
              className="text-xs text-red-400"
            >
              Eliminar
            </button>
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
