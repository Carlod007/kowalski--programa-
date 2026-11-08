import { useNavigate, useParams } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";
import { getMonthId, shiftMonthId } from "@/utils/date";
import { formatCents } from "@/utils/currency";
import BackButton from "@/components/BackButton";
import MonthClosingSummary from "@/components/MonthClosingSummary";

export default function CloseMonth() {
  const user = useAuthStore((s) => s.user);
  const userProfile = useAuthStore((s) => s.userProfile);
  const navigate = useNavigate();
  const { monthId: monthIdParam } = useParams<{ monthId: string }>();
  const currentMonthId = getMonthId();
  const viewedMonthId = monthIdParam ?? currentMonthId;
  const canGoForward = viewedMonthId < currentMonthId;

  function goTo(delta: number) {
    navigate(`/close-month/${shiftMonthId(viewedMonthId, delta)}`);
  }

  return (
    <div className="min-h-dvh bg-stone-50 px-5 pt-8 pb-10">
      <BackButton to="/dashboard" />
      <div className="mt-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-stone-900">Cierre de mes</h1>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => goTo(-1)} aria-label="Mes anterior"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-stone-200">‹</button>
          <button type="button" onClick={() => goTo(1)} disabled={!canGoForward} aria-label="Mes siguiente"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-stone-200 disabled:opacity-30">›</button>
        </div>
      </div>
      {user && <MonthClosingSummary key={`${user.uid}:${viewedMonthId}`} userId={user.uid} monthId={viewedMonthId}>
        <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-stone-400">Ahorro acumulado total</p>
          <p className="mt-2 text-2xl font-semibold text-teal-700">{formatCents(userProfile?.savingsTotalCents ?? 0)}</p>
        </div>
      </MonthClosingSummary>}
    </div>
  );
}
