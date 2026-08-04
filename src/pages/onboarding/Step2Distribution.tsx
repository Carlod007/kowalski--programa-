import type { Distribution } from "@/types/transaction";

type Props = {
  data: Distribution;
  onChange: (distribution: Distribution) => void;
  disabledKeys?: (keyof Distribution)[];
  minNecesidad?: number;
};

export default function Step2Distribution({
  data,
  onChange,
  disabledKeys = [],
  minNecesidad,
}: Props) {
  const total = data.necesidad + data.ocio + data.ahorro;
  const isValid = total === 100;
  const belowMinimum =
    minNecesidad !== undefined && data.necesidad < minNecesidad;

  function handleChange(key: keyof Distribution, value: number) {
    if (disabledKeys.includes(key)) return;
    onChange({ ...data, [key]: value });
  }

  function applyRecommendation() {
    if (minNecesidad === undefined) return;
    const remaining = 100 - minNecesidad;
    const restTotal = data.ocio + data.ahorro;
    const ocioShare = restTotal > 0 ? data.ocio / restTotal : 0.5;
    const newOcio = Math.round(remaining * ocioShare);
    const newAhorro = remaining - newOcio;
    onChange({ necesidad: minNecesidad, ocio: newOcio, ahorro: newAhorro });
  }

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-medium">Distribución porcentual</h2>
      <p className="text-xs text-gray-500">
        Decide cómo repartir tu dinero. Los tres porcentajes deben sumar 100%.
      </p>

      {(["necesidad", "ocio", "ahorro"] as (keyof Distribution)[]).map(
        (key) => {
          const isDisabled = disabledKeys.includes(key);
          return (
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
                disabled={isDisabled}
                className="w-full disabled:opacity-40"
              />
              {isDisabled && (
                <p className="text-xs text-stone-400">
                  Ya se acreditó este mes - se aplicará desde el próximo
                </p>
              )}
              {key === "necesidad" &&
                minNecesidad !== undefined &&
                (belowMinimum ? (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-red-500">
                      Según tus ingresos y necesidades declaradas, Necesidad
                      debería ser al menos {minNecesidad}%
                    </p>
                    <button
                      type="button"
                      onClick={applyRecommendation}
                      className="shrink-0 text-xs font-medium text-teal-600 underline"
                    >
                      Aplicar recomendación
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-stone-400">
                    Mínimo recomendado según tus ingresos y necesidades:{" "}
                    {minNecesidad}% (ya lo cumples)
                  </p>
                ))}
            </div>
          );
        },
      )}

      <p
        className={`text-sm font-medium ${isValid ? "text-teal-600" : "text-red-500"}`}
      >
        Total: {total}% {isValid ? "✓" : "- debe sumar 100%"}
      </p>
    </div>
  );
}
