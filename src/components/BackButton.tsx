import { useLocation, useNavigate } from "react-router-dom";

export function ArrowLeftIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="m14 7-5 5 5 5M9 12h10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Vuelve a la pantalla anterior real, no a un destino fijo: si llegaste a
 * Movimientos desde Análisis, volvés a Análisis y no al inicio.
 *
 * `to` queda como respaldo para cuando no hay historial propio al que volver
 * (se abrió la URL directo, o la PWA reabrió en esta pantalla). Sin ese
 * respaldo, el botón no haría nada o sacaría al usuario de la app.
 */
export default function BackButton({
  to,
  fixed = false,
  label = "Volver",
  onClick,
}: {
  to?: string;
  /**
   * Ignora el historial y va siempre a `to`. Para pantallas alcanzables desde
   * la barra inferior, donde volver a la anterior deja al usuario en un lugar
   * que no esperaba.
   */
  fixed?: boolean;
  label?: string;
  onClick?: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();

  function handleBack() {
    if (onClick) {
      onClick();
      return;
    }
    if (!to) return;
    if (fixed || location.key === "default") {
      navigate(to, { replace: true });
    } else {
      navigate(-1);
    }
  }

  return (
    <button
      type="button"
      onClick={handleBack}
      aria-label={label}
      className="inline-flex h-9 shrink-0 items-center gap-1 text-sm font-medium text-stone-500 transition-colors hover:text-stone-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-500"
    >
      <ArrowLeftIcon className="h-4 w-4" />
      <span>{label}</span>
    </button>
  );
}
