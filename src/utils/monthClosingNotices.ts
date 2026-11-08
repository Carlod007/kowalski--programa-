const PREFIX = 'kowalski:month-closing:v1:';
const CHANGE_EVENT = 'kowalski:month-closing-change';
type NoticeState = 'pending' | 'seen';

// Only used when browser storage is unavailable; financial operations still continue.
const fallback = new Map<string, NoticeState>();

function userPrefix(userId: string): string {
  return `${PREFIX}${encodeURIComponent(userId)}:`;
}

function keyFor(userId: string, monthId: string): string {
  return `${userPrefix(userId)}${monthId}`;
}

function readState(key: string): string | null {
  if (fallback.has(key)) return fallback.get(key)!;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeState(key: string, state: NoticeState): void {
  try {
    localStorage.setItem(key, state);
    fallback.delete(key);
  } catch {
    fallback.set(key, state);
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function rememberMonthClosing(userId: string, monthId: string | null): void {
  if (!monthId) return;
  const key = keyFor(userId, monthId);
  if (readState(key) !== 'seen') writeState(key, 'pending');
}

export function markMonthClosingSeen(userId: string, monthId: string): void {
  writeState(keyFor(userId, monthId), 'seen');
}

export function getPendingMonthClosings(userId: string): string[] {
  const prefix = userPrefix(userId);
  const keys = new Set(fallback.keys());
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key) keys.add(key);
    }
  } catch {
    // The in-memory fallback lasts until this tab is closed.
  }
  return [...keys]
    .filter((key) => key.startsWith(prefix) && readState(key) === 'pending')
    .map((key) => key.slice(prefix.length))
    .filter((monthId) => /^\d{4}-(0[1-9]|1[0-2])$/.test(monthId))
    .sort();
}

export function subscribeMonthClosingNotices(listener: () => void): () => void {
  function onStorage(event: StorageEvent) {
    if (event.key === null || event.key.startsWith(PREFIX)) listener();
  }
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}
