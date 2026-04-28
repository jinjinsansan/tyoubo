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
