import { getMonthId, toDateInputValue } from '@/utils/date';

export default function TransactionDateTimeFields({ date, onDateChange, editing = false }: {
  /** En registros nuevos, vacío significa usar la fecha de hoy al guardar. */
  date: string;
  onDateChange: (value: string) => void;
  editing?: boolean;
}) {
  const today = toDateInputValue();
  const monthId = getMonthId();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const previousDay = toDateInputValue(yesterday);
  const hasPastDayThisMonth = previousDay.startsWith(`${monthId}-`);

  if (!editing && !date) {
    return (
      <div>
        <p className="text-sm font-medium text-stone-700">Fecha: hoy</p>
        {hasPastDayThisMonth && (
          <button type="button" onClick={() => onDateChange(previousDay)}
            className="mt-2 text-sm font-medium text-teal-700">
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
        <input type="date" required min={`${monthId}-01`}
          max={editing ? today : previousDay}
          value={date} onChange={(event) => onDateChange(event.target.value)}
          className="mt-2 block w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900" />
      </label>
      {!editing && (
        <button type="button" onClick={() => onDateChange('')}
          className="mt-2 text-sm font-medium text-teal-700">
          Usar hoy
        </button>
      )}
    </div>
  );
}
