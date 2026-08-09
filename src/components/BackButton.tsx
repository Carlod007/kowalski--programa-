import { useLocation, useNavigate } from "react-router-dom";

function BackIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect
        x="1.5"
        y="1.5"
        width="21"
        height="21"
        rx="6"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M14 7l-5 5 5 5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ArrowLeftIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M18 7l-5 5 5 5"
        stroke="currentColor"
        strokeWidth="2.5"
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
export default function BackButton({ to }: { to: string }) {
  const navigate = useNavigate();
  const location = useLocation();

  function handleBack() {
    if (location.key === "default") {
      navigate(to, { replace: true });
    } else {
      navigate(-1);
    }
  }

  return (
    <button
      type="button"
      onClick={handleBack}
      aria-label="Volver"
      className="text-stone-500"
    >
      <BackIcon className="h-9 w-9" />
    </button>
  );
}
