import type { Distribution } from '@/types/transaction'

type Props = {
  data: Distribution
  onChange: (distribution: Distribution) => void
}

export default function Step2Distribution({ data, onChange }: Props) {
  const total = data.necesidad + data.ocio + data.ahorro
  const isValid = total === 100

  function handleChange(key: keyof Distribution, value: number) {
    onChange({ ...data, [key]: value })
  }

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-medium">Distribución porcentual</h2>
      <p className="text-xs text-gray-500">
        Decide cómo repartir tu dinero. Los tres porcentajes deben sumar 100%.
      </p>

      {(['necesidad', 'ocio', 'ahorro'] as (keyof Distribution)[]).map((key) => (
        <div key={key} className="flex flex-col gap-1">
          <div className="flex justify-between text-sm">
            <span className="capitalize">{key}</span>
            <span>{data[key]}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={data[key]}
            onChange={(e) => handleChange(key, Number(e.target.value))}
            className="w-full"
          />
        </div>
      ))}

      <p className={`text-sm font-medium ${isValid ? 'text-teal-600' : 'text-red-500'}`}>
        Total: {total}% {isValid ? '✓' : '— debe sumar 100%'}
      </p>
    </div>
  )
}