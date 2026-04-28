export interface RetryOptions {
  /** Number of attempts including the first. Default 3. */
  attempts?: number;
  /** Initial backoff delay before the second attempt. Default 250ms. */
  initialDelayMs?: number;
  /** Cap for any single backoff. Default 2000ms. */
  maxDelayMs?: number;
  /** Predicate; returning false bails out immediately. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** Optional label used by callers' loggers. */
  label?: string;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/**
 * Exponential-backoff retry with full jitter.
 *
 * The default `shouldRetry` retries every error — caller-supplied predicates
 * are how we limit retries to transient classes (5xx, network, 429). The
 * Anthropic SDK has its own retry; pair this only with calls that don't.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const initial = opts.initialDelayMs ?? 250;
  const cap = opts.maxDelayMs ?? 2000;

  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1) break;
      if (opts.shouldRetry && !opts.shouldRetry(err, i)) break;
      const exp = Math.min(cap, initial * 2 ** i);
      const delay = Math.floor(Math.random() * exp);
      await sleep(delay);
    }
  }
  throw lastErr;
}
