import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import MonthClosingSummary from '@/components/MonthClosingSummary';
import { useAuthStore } from '@/store/authStore';
import { acknowledgeClosedMonthSummary } from '@/services/monthService';
import {
  getPendingMonthClosings,
  markMonthClosingSeen,
  rememberMonthClosing,
  subscribeMonthClosingNotices,
} from '@/utils/monthClosingNotices';

export default function AutomaticMonthClosingSummary({
  userId,
  unseenClosedMonthId,
}: {
  userId: string;
  unseenClosedMonthId?: string | null;
}) {
  const storeUnseenMonthId = useAuthStore(
    (s) => s.userProfile?.unseenClosedMonthId,
  );
  const resolvedUnseenMonthId =
    unseenClosedMonthId !== undefined ? unseenClosedMonthId : storeUnseenMonthId;

  const previousUnseenRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (resolvedUnseenMonthId) {
      rememberMonthClosing(userId, resolvedUnseenMonthId);
    } else if (previousUnseenRef.current) {
      // Otro dispositivo ya marcó el resumen como visto: el espejo local debe
      // ceder ante Firestore. `undefined` significa que el perfil aún no cargó.
      markMonthClosingSeen(userId, previousUnseenRef.current);
    }
    previousUnseenRef.current = resolvedUnseenMonthId;
  }, [userId, resolvedUnseenMonthId]);

  const pending = useSyncExternalStore(
    subscribeMonthClosingNotices,
    () => getPendingMonthClosings(userId, resolvedUnseenMonthId).join(','),
    () => '',
  );
  // Keep the presented block on screen even after its durable state becomes "seen".
  const [presentedMonthId, setPresentedMonthId] = useState<string | null>(null);
  const monthId = presentedMonthId ?? (pending.split(',')[0] || null);
  const onPresented = useCallback(() => setPresentedMonthId(monthId), [monthId]);

  function handleDismiss() {
    if (monthId) {
      acknowledgeClosedMonthSummary(userId, monthId).catch((err) => {
        console.error('No se pudo confirmar lectura del resumen de cierre:', err);
      });
    }
    setPresentedMonthId(null);
  }

  if (!monthId) return null;
  return (
    <section
      className="mx-5 mt-5 rounded-2xl border border-teal-200 bg-teal-50 p-4"
      aria-label="Resumen del mes cerrado"
    >
      <h2 className="text-lg font-semibold text-stone-900">Cierre de mes</h2>
      <MonthClosingSummary
        key={monthId}
        userId={userId}
        monthId={monthId}
        closedOnly
        onPresented={onPresented}
      />
      <div className="mt-4 flex items-center justify-between gap-4">
        <Link
          to={`/close-month/${monthId}`}
          onClick={handleDismiss}
          className="text-sm font-medium text-teal-700"
        >
          Ver detalle
        </Link>
        {presentedMonthId && (
          <button
            type="button"
            onClick={handleDismiss}
            className="text-sm font-medium text-stone-600"
          >
            Entendido
          </button>
        )}
      </div>
    </section>
  );
}
