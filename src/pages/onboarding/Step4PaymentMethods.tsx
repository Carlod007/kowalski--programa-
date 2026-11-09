import { useState } from "react";
import type { PaymentMethod } from "@/types/user";
import { hasDuplicateCatalogName } from "@/utils/masterTables";

type Props = {
  data: PaymentMethod[];
  onChange: (paymentMethods: PaymentMethod[]) => void;
};

export default function Step4PaymentMethods({ data, onChange }: Props) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"cash" | "digital">("digital");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState<"cash" | "digital">("digital");
  const [error, setError] = useState<string | null>(null);

  function handleTypeChange(newType: "cash" | "digital") {
    setType(newType);
    if (newType === "cash") {
      if (name.trim() === "") {
        setName("Efectivo");
      }
    } else {
      if (name.trim().toLowerCase() === "efectivo") {
        setName("");
      }
    }
  }

  function handleEditTypeChange(newType: "cash" | "digital") {
    setEditType(newType);
    if (newType === "cash") {
      if (editName.trim() === "") {
        setEditName("Efectivo");
      }
    } else {
      if (editName.trim().toLowerCase() === "efectivo") {
        setEditName("");
      }
    }
  }

  function addMethod() {
    const raw = type === "cash" && name.trim() === "" ? "Efectivo" : name;
    const trimmed = raw.trim();
    if (trimmed === "") return;
    if (
      hasDuplicateCatalogName(
        data.map((m) => m.name),
        trimmed,
      )
    ) {
      setError("Ya existe un método de pago con ese nombre.");
      return;
    }
    setError(null);
    const newMethod: PaymentMethod = {
      id: crypto.randomUUID(),
      name: trimmed,
      type,
    };
    onChange([...data, newMethod]);
    setName("");
    setType("digital");
  }

  function removeMethod(id: string) {
    setError(null);
    onChange(data.filter((m) => m.id !== id));
  }

  function startEdit(method: PaymentMethod) {
    setError(null);
    setEditingId(method.id);
    setEditName(method.name);
    setEditType(method.type);
  }

  function saveEdit() {
    const raw = editType === "cash" && editName.trim() === "" ? "Efectivo" : editName;
    const trimmed = raw.trim();
    if (trimmed === "") return;
    const existingMethod = data.find((m) => m.id === editingId);
    if (
      hasDuplicateCatalogName(
        data.map((m) => m.name),
        trimmed,
        existingMethod?.name,
      )
    ) {
      setError("Ya existe un método de pago con ese nombre.");
      return;
    }
    setError(null);
    onChange(
      data.map((m) =>
        m.id === editingId ? { ...m, name: trimmed, type: editType } : m,
      ),
    );
    setEditingId(null);
  }

  function cancelEdit() {
    setError(null);
    setEditingId(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">Métodos de pago</h2>
      <p className="text-xs text-gray-500">
        ¿Con qué pagas? Tarjetas, apps o efectivo.
      </p>
      <p className="text-xs text-gray-400 italic">
        Ejemplos: Efectivo, Yape, Tarjeta BCP
      </p>

      {data.map((method) => (
        <div
          key={method.id}
          className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-3"
        >
          {editingId === method.id ? (
            <div className="flex flex-1 items-center gap-2">
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveEdit()}
                autoFocus
                className="flex-1 rounded-lg border border-gray-300 px-2 py-1 text-sm outline-none"
              />
              <select
                value={editType}
                onChange={(e) =>
                  handleEditTypeChange(e.target.value as "cash" | "digital")
                }
                className="rounded-lg border border-gray-300 px-1 text-sm outline-none"
              >
                <option value="digital">Digital</option>
                <option value="cash">Efectivo</option>
              </select>
              <button
                onClick={saveEdit}
                className="text-xs font-medium text-teal-600"
              >
                Guardar
              </button>
              <button onClick={cancelEdit} className="text-xs text-gray-400">
                Cancelar
              </button>
            </div>
          ) : (
            <>
              <div>
                <span className="text-sm">{method.name}</span>
                {!(
                  method.type === "cash" &&
                  method.name.trim().toLowerCase() === "efectivo"
                ) && (
                  <span className="ml-2 text-xs text-gray-400">
                    {method.type === "digital" ? "Digital" : "Efectivo"}
                  </span>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => startEdit(method)}
                  className="text-xs text-teal-600"
                >
                  Editar
                </button>
                <button
                  onClick={() => removeMethod(method.id)}
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
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addMethod()}
          placeholder={type === "cash" ? "Efectivo" : "Nombre del método"}
          className="min-w-0 flex-1 rounded-lg bg-gray-50 px-3 py-3 text-sm outline-none"
        />
        <select
          value={type}
          onChange={(e) => handleTypeChange(e.target.value as "cash" | "digital")}
          className="rounded-lg bg-gray-50 px-2 text-sm outline-none"
        >
          <option value="digital">Digital</option>
          <option value="cash">Efectivo</option>
        </select>
        <button
          onClick={addMethod}
          className="rounded-lg bg-teal-600 px-4 text-sm font-medium text-white"
        >
          +
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
