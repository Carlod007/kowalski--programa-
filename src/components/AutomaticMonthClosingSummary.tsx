import { useCallback, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import MonthClosingSummary from '@/components/MonthClosingSummary';
import { getPendingMonthClosings, subscribeMonthClosingNotices } from '@/utils/monthClosingNotices';

export default function AutomaticMonthClosingSummary({ userId }: { userId: string }) {
  const pending = useSyncExternalStore(subscribeMonthClosingNotices,
    () => getPendingMonthClosings(userId).join(','), () => '');
  // Keep the presented block on screen even after its durable state becomes "seen".
  const [presentedMonthId, setPresentedMonthId] = useState<string | null>(null);
  const monthId = presentedMonthId ?? (pending.split(',')[0] || null);
  const onPresented = useCallback(() => setPresentedMonthId(monthId), [monthId]);
  if (!monthId) return null;
  return <section className="mx-5 mt-5 rounded-2xl border border-teal-200 bg-teal-50 p-4" aria-label="Resumen del mes cerrado">
    <h2 className="text-lg font-semibold text-stone-900">Cierre de mes</h2>
    <MonthClosingSummary key={monthId} userId={userId} monthId={monthId} closedOnly onPresented={onPresented} />
    <div className="mt-4 flex items-center justify-between gap-4">
      <Link to={`/close-month/${monthId}`} className="text-sm font-medium text-teal-700">Ver detalle</Link>
      {presentedMonthId && <button type="button" onClick={() => setPresentedMonthId(null)} className="text-sm font-medium text-stone-600">Entendido</button>}
    </div>
  </section>;
}
