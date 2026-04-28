import { randomUUID } from 'node:crypto';

export function newId(): string {
  return randomUUID();
}

/**
 * Compact token (UUID minus dashes) for use inside Telegram callback_data,
 * which has a 64-byte cap. 32 chars + a 5-char prefix leaves headroom.
 */
export function newToken(): string {
  return randomUUID().replace(/-/g, '');
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** YYYY-MM-DD in JST regardless of process TZ. */
export function todayJst(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return fmt.format(new Date());
}

/** YYYY-MM in JST for the calendar month preceding `now`. */
export function previousYearMonthJst(now = new Date()): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit'
  });
  const parts = fmt.formatToParts(now);
  const y = Number(parts.find((p) => p.type === 'year')!.value);
  const m = Number(parts.find((p) => p.type === 'month')!.value);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, '0')}`;
}

/** Last calendar day of the given YYYY-MM (e.g. "2026-04" → "2026-04-30"). */
export function lastDayOfMonthIso(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  // Date.UTC(y, m, 0) returns the last day of month m (1-indexed input,
  // 0-day-of-next-month gives last-day-of-current-month).
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

/** "2026年04月" — used in the monthly report header. */
export function formatYearMonthJa(yearMonth: string): string {
  const [y, m] = yearMonth.split('-');
  return `${y}年${m}月`;
}
