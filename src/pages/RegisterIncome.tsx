import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate, Link } from 'react-router-dom'
import {
  collection,
  doc,
  increment,
  serverTimestamp,
  writeBatch,
  type UpdateData,
  type WithFieldValue,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuthStore } from '@/store/authStore'
import { getMonthId } from '@/utils/date'
import { calculateDistribution } from '@/utils/distribution'
import type { IncomeTransaction } from '@/types/transaction'
import type { Month } from '@/types/month'

const incomeSchema = z.object({
  source: z.string().min(1, 'Selecciona una fuente'),
  amount: z
    .string()
    .min(1, 'Ingresa un monto')
    .refine((v) => Number.isFinite(parseFloat(v)) && parseFloat(v) > 0, {
      message: 'El monto debe ser mayor a 0',
    }),
  description: z.string().optional(),
})

type IncomeFormValues = z.infer<typeof incomeSchema>

export default function RegisterIncome() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const userProfile = useAuthStore((s) => s.userProfile)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<IncomeFormValues>({
    resolver: zodResolver(incomeSchema),
    defaultValues: { source: '', amount: '', description: '' },
  })

  const sources = userProfile?.sources ?? []

  async function onSubmit(values: IncomeFormValues) {
    if (!user || !userProfile) return
    setSubmitError(null)

    const amountCents = Math.round(parseFloat(values.amount) * 100)
    const distribution = calculateDistribution(amountCents, userProfile.distribution)
    const monthId = getMonthId()
    const description = values.description?.trim()

    const batch = writeBatch(db)

    const txRef = doc(collection(db, 'users', user.uid, 'months', monthId, 'transactions'))
    const tx: WithFieldValue<IncomeTransaction> = {
      type: 'income',
      source: values.source,
      amountCents,
      distribution,
      serverDate: serverTimestamp(),
      localDate: new Date().toISOString(),
      ...(description ? { description } : {}),
    }
    batch.set(txRef, tx)

    const monthRef = doc(db, 'users', user.uid, 'months', monthId)
    const monthUpdate: UpdateData<Month> = {
      totalIncomeCents: increment(amountCents),
      'capsCents.necesidad': increment(distribution.necesidad),
      'capsCents.ocio': increment(distribution.ocio),
      'capsCents.ahorro': increment(distribution.ahorro),
    }
    batch.update(monthRef, monthUpdate)

    try {
      await batch.commit()
      navigate('/dashboard')
    } catch (err) {
      console.error('Error al registrar ingreso:', err)
      setSubmitError('No se pudo guardar. Revisa tu conexión e intenta de nuevo.')
    }
  }

  if (sources.length === 0) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-stone-600">Todavía no tenés fuentes de ingreso configuradas.</p>
        <Link to="/dashboard" className="text-sm font-medium text-teal-700">
          Volver al inicio
        </Link>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-stone-50 px-5 pt-8 pb-10">
      <Link to="/dashboard" className="text-sm text-stone-500">
        ← Cancelar
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-stone-900">Registrar ingreso</h1>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <label htmlFor="source" className="text-sm font-medium text-stone-700">
            Fuente
          </label>
          <select
            id="source"
            {...register('source')}
            className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-stone-900"
          >
            <option value="">Selecciona una fuente</option>
            {sources.map((s) => (
              <option key={s.id} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
          {errors.source && <p className="text-xs text-red-600">{errors.source.message}</p>}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="amount" className="text-sm font-medium text-stone-700">
            Monto (S/)
          </label>
          <input
            id="amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            placeholder="0.00"
            {...register('amount')}
            className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-stone-900"
          />
          {errors.amount && <p className="text-xs text-red-600">{errors.amount.message}</p>}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="description" className="text-sm font-medium text-stone-700">
            Descripción <span className="text-stone-400">(opcional)</span>
          </label>
          <input
            id="description"
            type="text"
            {...register('description')}
            className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-stone-900"
          />
        </div>

        {submitError && <p className="text-sm text-red-600">{submitError}</p>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-2 rounded-xl bg-teal-600 py-3 font-medium text-white disabled:opacity-50"
        >
          {isSubmitting ? 'Guardando...' : 'Guardar ingreso'}
        </button>
      </form>
    </div>
  )
}