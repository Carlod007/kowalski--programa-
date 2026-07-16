import { useState } from 'react'
import type { PaymentMethod } from '@/types/user'

type Props = {
  data: PaymentMethod[]
  onChange: (paymentMethods: PaymentMethod[]) => void
}

export default function Step4PaymentMethods({ data, onChange }: Props) {
  const [name, setName] = useState('')
  const [type, setType] = useState<'cash' | 'digital'>('digital')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editType, setEditType] = useState<'cash' | 'digital'>('digital')

  function addMethod() {
    if (name.trim() === '') return
    const newMethod: PaymentMethod = {
      id: crypto.randomUUID(),
      name: name.trim(),
      type,
    }
    onChange([...data, newMethod])
    setName('')
    setType('digital')
  }

  function removeMethod(id: string) {
    onChange(data.filter((m) => m.id !== id))
  }

  function startEdit(method: PaymentMethod) {
    setEditingId(method.id)
    setEditName(method.name)
    setEditType(method.type)
  }

  function saveEdit() {
    const trimmed = editName.trim()
    if (trimmed === '') return
    onChange(
      data.map((m) =>
        m.id === editingId ? { ...m, name: trimmed, type: editType } : m,
      ),
    )
    setEditingId(null)
  }

  function cancelEdit() {
    setEditingId(null)
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
        <div key={method.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-3">
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
                onChange={(e) => setEditType(e.target.value as "cash" | "digital")}
                className="rounded-lg border border-gray-300 px-1 text-sm outline-none"
              >
                <option value="digital">Digital</option>
                <option value="cash">Efectivo</option>
              </select>
              <button onClick={saveEdit} className="text-xs font-medium text-teal-600">
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
                <span className="ml-2 text-xs text-gray-400">
                  {method.type === "digital" ? "Digital" : "Efectivo"}
                </span>
              </div>
              <div className="flex gap-3">
                <button onClick={() => startEdit(method)} className="text-xs text-teal-600">
                  Editar
                </button>
                <button onClick={() => removeMethod(method.id)} className="text-xs text-red-400">
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
          onKeyDown={(e) => e.key === 'Enter' && addMethod()}
          placeholder="Nombre del método"
          className="flex-1 rounded-lg bg-gray-50 px-3 py-3 text-sm outline-none"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as 'cash' | 'digital')}
          className="rounded-lg bg-gray-50 px-2 text-sm outline-none"
        >
          <option value="digital">Digital</option>
          <option value="cash">Efectivo</option>
        </select>
        <button onClick={addMethod} className="rounded-lg bg-teal-600 px-4 text-sm font-medium text-white">
          +
        </button>
      </div>
    </div>
  )
}