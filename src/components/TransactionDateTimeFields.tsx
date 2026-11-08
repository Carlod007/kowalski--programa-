import { useAuthStore } from '@/store/authStore';
import { getMonthId, shiftMonthId, toDateInputValue } from '@/utils/date';
import { isWithinGraceWindow } from '@/utils/transactionTiming';

export default function TransactionDateTimeFields({
  date,
  onDateChange,
  editing = false,
  monthId: explicitMonthId,
}: {
  /** En registros nuevos, vacío significa usar la fecha de hoy al guardar. */
  date: string;
  onDateChange: (value: string) => void;
  editing?: boolean;
  monthId?: string;
}) {
  const pendingCloseMonthId = useAuthStore(
    (s) => s.userProfile?.pendingCloseMonthId,
  );
  const now = new Date();
  const today = toDateInputValue(now);
  const currentMonthId = getMonthId(now);
  const prevMonthId = shiftMonthId(currentMonthId, -1);
  const canUsePreviousMonth =
    isWithinGraceWindow(now) &&
    (pendingCloseMonthId === prevMonthId || explicitMonthId === prevMonthId);

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const previousDay = toDateInputValue(yesterday);
  const hasPastDayAllowed =
    previousDay.startsWith(`${currentMonthId}-`) || canUsePreviousMonth;

  const targetMonthForBounds = explicitMonthId ?? currentMonthId;
  const minDate = editing
    ? `${targetMonthForBounds}-01`
    : canUsePreviousMonth
      ? `${prevMonthId}-01`
      : `${currentMonthId}-01`;

  let maxDate = editing ? today : previousDay;
  if (editing && explicitMonthId && explicitMonthId < currentMonthId) {
    const [year, month] = explicitMonthId.split('-').map(Number);
    const lastDay = new Date(year, month, 0);
    maxDate = toDateInputValue(lastDay);
  }

  if (!editing && !date) {
    return (
      <div>
        <p className="text-sm font-medium text-stone-700">Fecha: hoy</p>
        {hasPastDayAllowed && (
          <button
            type="button"
            onClick={() => onDateChange(previousDay)}
            className="mt-2 text-sm font-medium text-teal-700"
          >
            Registrar un día pasado
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <label className="block text-sm font-medium text-stone-700">
        {editing ? 'Corregir fecha' : 'Fecha del día pasado'}
        <input
          type="date"
          required
          min={minDate}
          max={maxDate}
          value={date}
          onChange={(event) => onDateChange(event.target.value)}
          className="mt-2 block w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
        />
      </label>
      {!editing && (
        <button
          type="button"
          onClick={() => onDateChange('')}
          className="mt-2 text-sm font-medium text-teal-700"
        >
          Usar hoy
        </button>
      )}
    </div>
  );
}
