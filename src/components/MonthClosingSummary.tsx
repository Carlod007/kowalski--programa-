import { useEffect, useRef, useState, type ReactNode } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Month } from '@/types/month';
import { formatMonthLabel } from '@/utils/date';
import { formatCents } from '@/utils/currency';
import { getMonthRemainders } from '@/utils/monthRemainders';
import { acknowledgeClosedMonthSummary } from '@/services/monthService';

/** Mount with a user/month key so a previous response is never shown for another month. */
export default function MonthClosingSummary({ userId, monthId, closedOnly = false, onPresented, children }: {
  userId: string;
  monthId: string;
  closedOnly?: boolean;
  onPresented?: () => void;
  children?: ReactNode;
}) {
  const [result, setResult] = useState<{ month: Month | null; error: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getDoc(doc(db, 'users', userId, 'months', monthId)).then(
      (snap) => {
        if (!cancelled) setResult({ month: snap.exists() ? snap.data() as Month : null, error: false });
      },
      (error) => {
        console.error('MonthClosingSummary load error:', error);
        if (!cancelled) setResult({ month: null, error: true });
      },
    );
    return () => { cancelled = true; };
  }, [userId, monthId, attempt]);

  if (!result) return <p className="mt-4 text-sm text-stone-500" role="status">Cargando resumen...</p>;
  if (result.error || !result.month || (closedOnly && !result.month.closed)) {
    return (
      <div className="mt-4 text-sm">
        <p className={result.error ? 'text-red-600' : 'text-stone-500'}>
          {result.error ? 'Error al cargar el resumen. Intenta de nuevo.' : 'Sin datos de cierre para este mes.'}
        </p>
        <button type="button" className="mt-2 font-medium text-teal-700" onClick={() => {
          setResult(null);
          setAttempt((value) => value + 1);
        }}>Reintentar</button>
      </div>
    );
  }
  return <><PresentedSummary userId={userId} monthId={monthId} month={result.month} onPresented={onPresented} />{children}</>;
}

function PresentedSummary({ userId, monthId, month, onPresented }: {
  userId: string;
  monthId: string;
  month: Month;
  onPresented?: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (month.closed !== true || !container.current) return;
    const element = container.current;
    let intersecting = false;
    let presented = false;
    let frame: number | null = null;
    function present() {
      if (!intersecting || document.visibilityState !== 'visible' || presented || frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (!intersecting || document.visibilityState !== 'visible' || presented) return;
        presented = true;
        onPresented?.();
        acknowledgeClosedMonthSummary(userId, monthId).catch((err) => {
          console.error('No se pudo actualizar unseenClosedMonthId:', err);
        });
      });
    }
    const observer = new IntersectionObserver(([entry]) => {
      intersecting = entry.isIntersecting;
      present();
    });
    observer.observe(element);
    document.addEventListener('visibilitychange', present);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', present);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [userId, monthId, month.closed, onPresented]);
  return <div ref={container}><MonthClosingSummaryContent monthId={monthId} month={month} /></div>;
}

export function MonthClosingSummaryContent({ monthId, month }: { monthId: string; month: Month }) {
  const isProjection = month.closed === false;
  const remainders = getMonthRemainders(month);
  const necesidadToNext = isProjection
    ? remainders.necesidadToNextMonthCents
    : (month.remainder?.necesidadToNextMonthCents ?? remainders.necesidadToNextMonthCents);
  const necesidadSweptToAhorro = isProjection
    ? 0
    : (month.remainder?.necesidadSweptToAhorroCents ?? 0);
  const ocioToSavings = isProjection
    ? remainders.ocioToAhorroCents
    : month.remainder?.ocioToAhorroCents;
  const ocioToNext = isProjection
    ? 0
    : (month.remainder?.ocioToNextMonthCents ?? 0);
  const netDeficit = isProjection
    ? remainders.netDeficitCents
    : (month.remainder?.netDeficitCents ?? remainders.netDeficitCents);
  const borrowedNecesidad = isProjection
    ? remainders.borrowed.necesidad
    : (month.remainder?.borrowedNecesidadCents ?? remainders.borrowed.necesidad);
  const borrowedOcio = isProjection
    ? remainders.borrowed.ocio
    : (month.remainder?.borrowedOcioCents ?? remainders.borrowed.ocio);
  const deficitResolution = month.remainder?.deficitResolution;
  const coveredBySavings = month.remainder?.coveredBySavingsCents ?? 0;
  const uncoveredDeficit = month.remainder?.uncoveredDeficitCents ?? Math.max(0, netDeficit - coveredBySavings);

  return (
    <>
      <p className="mt-1 text-sm text-stone-500">
        {isProjection ? `Así va ${formatMonthLabel(monthId)}` : `Así quedó ${formatMonthLabel(monthId)}`}
      </p>
      {isProjection && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
        <p className="text-xs font-medium text-amber-700">Proyección - el mes sigue abierto, esto no es definitivo todavía.</p>
      </div>}
      <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-stone-400">Resumen {formatMonthLabel(monthId)}</p>
        <div className="mt-3 flex flex-col gap-2">
          <Row label="Ingreso total" value={month.totalIncomeCents} />
          <Row label="Necesidad gastado" value={month.spentCents.necesidad} />
          <Row label="Ocio gastado" value={month.spentCents.ocio} />
        </div>
      </div>
      <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-stone-400">
          {isProjection ? 'Qué pasaría con el saldo sobrante si cerrara ahora' : 'Qué pasó con el saldo sobrante'}
        </p>
        <div className="mt-3 flex flex-col gap-2">
          {(necesidadToNext > 0 || necesidadSweptToAhorro === 0) && (
            <Row label={`Necesidad propia no usada → ${isProjection ? 'se sumaría' : 'se sumó'} al mes nuevo`} value={necesidadToNext} />
          )}
          {necesidadSweptToAhorro > 0 && (
            <Row label={`Necesidad propia no usada → ${isProjection ? 'se sumaría' : 'se sumó'} a tu Ahorro`} value={necesidadSweptToAhorro} valueClassName="text-teal-700" />
          )}
          <Row label={`Necesidad prestada no usada → ${isProjection ? 'continuaría' : 'continuó'} al mes nuevo`} value={borrowedNecesidad} valueClassName="text-violet-700" />
          {ocioToNext > 0 && (
            <Row label={`Ocio propio sobrante → ${isProjection ? 'se sumaría' : 'se sumó'} al mes nuevo`} value={ocioToNext} />
          )}
          {ocioToNext === 0 && (
            <Row label={`Ocio propio sobrante → ${isProjection ? 'se sumaría' : 'se sumó'} a tu Ahorro`} value={ocioToSavings} valueClassName="text-teal-700" />
          )}
          {borrowedOcio > 0 && <Row label={`Ocio prestado no usado → ${isProjection ? 'continuaría' : 'continuó'} al mes nuevo`} value={borrowedOcio} valueClassName="text-violet-700" />}
          <Row label="Déficit neto del mes" value={netDeficit} valueClassName={netDeficit > 0 ? 'text-amber-700' : 'text-stone-900'} />
          {!isProjection && netDeficit > 0 && deficitResolution === 'covered_by_savings' && (
            <>
              <Row label="Cubierto con ahorro sin asignar" value={coveredBySavings} valueClassName="text-teal-700" />
              {uncoveredDeficit > 0 && (
                <Row label="Déficit pendiente sin cubrir" value={uncoveredDeficit} valueClassName="text-amber-700" />
              )}
            </>
          )}
          {!isProjection && netDeficit > 0 && deficitResolution === 'carried_forward' && (
            <Row label="Déficit arrastrado al mes siguiente" value={netDeficit} valueClassName="text-amber-700" />
          )}
          {!isProjection && netDeficit > 0 && (!deficitResolution || deficitResolution === 'none') && (
            <p className="mt-1 text-xs text-amber-700">
              Este déficit quedó registrado sin cubrir. Puedes compensarlo desde Historial con un asiento de ajuste.
            </p>
          )}
        </div>
      </div>
    </>
  );
}

function Row({ label, value, valueClassName = 'text-stone-900' }: {
  label: string;
  value: number | null | undefined;
  valueClassName?: string;
}) {
  return <div className="flex items-center justify-between gap-3">
    <span className="text-sm text-stone-600">{label}</span>
    <span className={`text-sm font-medium whitespace-nowrap ${valueClassName}`}>
      {Number.isInteger(value) ? formatCents(value!) : 'No disponible'}
    </span>
  </div>;
}
