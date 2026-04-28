import Anthropic from '@anthropic-ai/sdk';
import { getEnv } from '@/lib/utils/env';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('llm');

let cached: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!cached) cached = new Anthropic({ apiKey: getEnv().ANTHROPIC_API_KEY });
  return cached;
}

export type CallParams = Omit<
  Anthropic.MessageCreateParamsNonStreaming,
  'model' | 'stream'
>;

/**
 * Calls the primary model (Opus 4.7) and falls back to Sonnet 4.6 on
 * recoverable errors (5xx, overloaded, rate-limited).
 *
 * Note: Opus 4.7 rejects `temperature` / `top_p` / `top_k` / `budget_tokens`.
 * Callers must not pass those — see KumiBooks_spec_v1 §6.4 and the SDK skill.
 */
export async function callClaude(
  params: CallParams
): Promise<Anthropic.Message> {
  const env = getEnv();
  const client = getAnthropic();
  try {
    return await client.messages.create({
      model: env.LLM_PRIMARY_MODEL,
      ...params
    });
  } catch (err) {
    if (!isRecoverable(err)) throw err;
    log.warn('primary model failed, falling back', {
      primary: env.LLM_PRIMARY_MODEL,
      fallback: env.LLM_FALLBACK_MODEL,
      err: err instanceof Error ? err.message : String(err)
    });
    return await client.messages.create({
      model: env.LLM_FALLBACK_MODEL,
      ...params
    });
  }
}

function isRecoverable(err: unknown): boolean {
  if (err instanceof Anthropic.RateLimitError) return true;
  if (err instanceof Anthropic.InternalServerError) return true;
  if (err instanceof Anthropic.APIError) {
    return err.status !== undefined && err.status >= 500;
  }
  return false;
}

/**
 * Extracts the first tool_use block matching `name`, with its parsed input.
 * Returns null if the model didn't call the tool — possible if `tool_choice`
 * was `auto`. Throws on shape mismatch (caller should treat as 5xx-equivalent).
 */
export function extractToolUse<T>(
  msg: Anthropic.Message,
  name: string
): { id: string; input: T } | null {
  for (const block of msg.content) {
    if (block.type === 'tool_use' && block.name === name) {
      return { id: block.id, input: block.input as T };
    }
  }
  return null;
}

/** Pulls all text content from a message (joins with newlines). */
export function extractText(msg: Anthropic.Message): string {
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}
