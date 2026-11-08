import { checkAndCloseMonth } from '@/services/monthService';
import { rememberMonthClosing } from '@/utils/monthClosingNotices';

const inFlight = new Map<string, Promise<Awaited<ReturnType<typeof checkAndCloseMonth>>>>();

/** Keep UI/storage side effects outside Firestore's retryable transaction callback. */
export function checkAndRememberMonthClosing(userId: string) {
  const existing = inFlight.get(userId);
  if (existing) return existing;
  // Mount effects (including StrictMode) and submissions can overlap in the same tab.
  const request = (async () => {
    try {
      const result = await checkAndCloseMonth(userId);
      rememberMonthClosing(userId, result.closedMonthId);
      return result;
    } finally {
      inFlight.delete(userId);
    }
  })();
  inFlight.set(userId, request);
  return request;
}
