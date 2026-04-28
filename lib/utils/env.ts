import { z } from 'zod';

const envSchema = z.object({
  // Google Sheets
  GOOGLE_SHEETS_ID: z.string().min(10),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().email(),
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: z.string().min(20),

  // Anthropic
  ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-'),
  LLM_PRIMARY_MODEL: z.string().default('claude-opus-4-7'),
  LLM_FALLBACK_MODEL: z.string().default('claude-sonnet-4-6'),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(20),
  TELEGRAM_GROUP_ID: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16),

  // Cron
  CRON_SECRET: z.string().min(16),

  // Optional Redis
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  // Operational
  TZ: z.string().default('Asia/Tokyo'),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development')
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/**
 * Validates and returns process.env using zod.
 * Throws on first call if any required variable is missing.
 * Result is cached for subsequent calls.
 */
export function getEnv(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`[env] invalid environment variables:\n${issues}`);
  }

  cached = {
    ...parsed.data,
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: parsed.data
      .GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n')
  };

  return cached;
}

/** Returns true if the given Telegram chat id matches the allowed group. */
export function isAllowedChat(chatId: number | string): boolean {
  return String(chatId) === String(getEnv().TELEGRAM_GROUP_ID);
}
