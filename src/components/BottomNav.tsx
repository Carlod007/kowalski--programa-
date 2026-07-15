import { NavLink } from "react-router-dom";
import type { ComponentType } from "react";

const items: {
  to: string;
  label: string;
  icon: ComponentType<{ active: boolean }>;
}[] = [
  { to: "/dashboard", label: "Inicio", icon: HomeIcon },
  { to: "/history", label: "Historial", icon: ListIcon },
  { to: "/charts", label: "Análisis", icon: ChartIcon },
];

export default function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 flex border-t border-stone-200 bg-white">
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center gap-1 py-3 text-xs ${
              isActive ? "text-emerald-600" : "text-stone-400"
            }`
          }
        >
          {({ isActive }) => (
            <>
              <Icon active={isActive} />
              {label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2.5 : 2}
    >
      <path
        d="M3 11.5 12 4l9 7.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ListIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2.5 : 2}
    >
      <circle cx="4" cy="6" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="18" r="1" />
      <path d="M9 6h11M9 12h11M9 18h11" strokeLinecap="round" />
    </svg>
  );
}

function ChartIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2.5 : 2}
    >
      <path
        d="M5 20V10M12 20V4M19 20v-7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
