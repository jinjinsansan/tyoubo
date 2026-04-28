type Level = 'info' | 'warn' | 'error' | 'debug';

const SECRET_KEYS = [
  'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
  'ANTHROPIC_API_KEY',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
  'CRON_SECRET',
  'UPSTASH_REDIS_REST_TOKEN',
  'private_key',
  'authorization',
  'Authorization'
];

function redact(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEYS.includes(k) ? '[REDACTED]' : redact(v);
  }
  return out;
}

function emit(level: Level, scope: string, msg: string, meta?: unknown) {
  const entry = {
    t: new Date().toISOString(),
    level,
    scope,
    msg,
    ...(meta !== undefined ? { meta: redact(meta) } : {})
  };
  // Single-line JSON for Vercel logs
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function createLogger(scope: string) {
  return {
    info: (msg: string, meta?: unknown) => emit('info', scope, msg, meta),
    warn: (msg: string, meta?: unknown) => emit('warn', scope, msg, meta),
    error: (msg: string, meta?: unknown) => emit('error', scope, msg, meta),
    debug: (msg: string, meta?: unknown) => emit('debug', scope, msg, meta)
  };
}
