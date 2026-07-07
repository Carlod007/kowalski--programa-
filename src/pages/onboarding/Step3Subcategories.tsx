// src/pages/onboarding/Step3Subcategories.tsx
import { useState } from "react";
import type { Category } from "@/types/transaction";

type Props = {
  data: Record<Category, string[]>;
  onChange: (subcategories: Record<Category, string[]>) => void;
};

const CATEGORY_LABELS: Record<Category, string> = {
  necesidad: "Necesidad",
  ocio: "Ocio",
  ahorro: "Ahorro",
};

export default function Step3Subcategories({ data, onChange }: Props) {
  const [inputs, setInputs] = useState<Record<Category, string>>({
    necesidad: "",
    ocio: "",
    ahorro: "",
  });

  function addSubcategory(category: Category) {
    const value = inputs[category].trim();
    if (value === "") return;
    onChange({
      ...data,
      [category]: [...data[category], value],
    });
    setInputs((i) => ({ ...i, [category]: "" }));
  }

  function removeSubcategory(category: Category, sub: string) {
    onChange({
      ...data,
      [category]: data[category].filter((s) => s !== sub),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-medium">Subcategorías</h2>
      <p className="text-xs text-gray-500">
        Define las cajitas dentro de cada grupo. Puedes editarlas después desde
        Ajustes.
      </p>

      {(["necesidad", "ocio", "ahorro"] as Category[]).map((category) => (
        <div key={category} className="flex flex-col gap-2">
          <p className="text-sm font-medium">{CATEGORY_LABELS[category]}</p>

          {data[category].map((sub) => (
            <div
              key={sub}
              className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2"
            >
              <span className="text-sm">{sub}</span>
              <button
                onClick={() => removeSubcategory(category, sub)}
                className="text-xs text-red-400"
              >
                Eliminar
              </button>
            </div>
          ))}

          <div className="flex gap-2">
            <input
              value={inputs[category]}
              onChange={(e) =>
                setInputs((i) => ({ ...i, [category]: e.target.value }))
              }
              onKeyDown={(e) => e.key === "Enter" && addSubcategory(category)}
              placeholder={`Nueva subcategoría`}
              className="flex-1 rounded-lg bg-gray-50 px-3 py-2 text-sm outline-none"
            />
            <button
              onClick={() => addSubcategory(category)}
              className="rounded-lg bg-teal-600 px-4 text-sm font-medium text-white"
            >
              +
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
