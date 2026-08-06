import { CATEGORY_META } from "@/utils/category";
import type { Category } from "@/types/transaction";

export default function CategoryIcon({
  category,
  size = "h-9 w-9",
}: {
  category: Category;
  size?: string;
}) {
  const meta = CATEGORY_META[category];

  return (
    <span
      className={`flex ${size} shrink-0 items-center justify-center rounded-full ${meta.bg} ${meta.text}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        {category === "necesidad" && (
          <>
            <path d="M3 11.5 12 4l9 7.5" />
            <path d="M5 10v9a1 1 0 0 0 1 1h3v-6h6v6h3a1 1 0 0 0 1-1v-9" />
          </>
        )}
        {category === "ocio" && (
          <>
            <path d="M6 7h12l1 13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L6 7z" />
            <path d="M9 7V6a3 3 0 0 1 6 0v1" />
          </>
        )}
        {category === "ahorro" && (
          // Ícono "piggy-bank" de Lucide (lucide.dev, licencia ISC).
          <>
            <path d="M11 17h3v2a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3a3.16 3.16 0 0 0 2-2h1a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1h-1a5 5 0 0 0-2-4V3a4 4 0 0 0-3.2 1.6l-.3.4H11a6 6 0 0 0-6 6v1a5 5 0 0 0 2 4v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1z" />
            <path d="M16 10h.01" />
          </>
        )}
      </svg>
    </span>
  );
}
