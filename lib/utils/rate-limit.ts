import { createLogger } from './logger';

const log = createLogger('rate');

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
/**
 * In-memory ring of recent message timestamps per Telegram user.
 * Single-instance only — Vercel Serverless cold starts reset this.
 * That is acceptable for a soft 10/min cap that exists mainly to stop
 * a runaway loop or accidental flood, not to enforce billing limits.
 *
 * For a stricter cap, swap to Upstash Redis with a sliding-window key.
 */
const recent = new Map<number, number[]>();

export type RateCheck =
  | { ok: true }
  | { ok: false; retryInSec: number };

export function checkRate(tgId: number, now = Date.now()): RateCheck {
  const cutoff = now - WINDOW_MS;
  const prior = (recent.get(tgId) ?? []).filter((t) => t > cutoff);

  if (prior.length >= MAX_PER_WINDOW) {
    const oldest = prior[0];
    const retryInSec = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
    log.warn('rate limited', {
      tg_id: tgId,
      window_count: prior.length,
      retry_in: retryInSec
    });
    return { ok: false, retryInSec };
  }

  prior.push(now);
  recent.set(tgId, prior);

  // Opportunistic cleanup so the map doesn't grow unbounded across long
  // sessions. Cheap (probabilistic) and avoids a separate sweeper.
  if (Math.random() < 0.05) {
    for (const [id, ts] of recent) {
      const filtered = ts.filter((t) => t > cutoff);
      if (filtered.length === 0) recent.delete(id);
      else if (filtered.length !== ts.length) recent.set(id, filtered);
    }
  }

  return { ok: true };
}
