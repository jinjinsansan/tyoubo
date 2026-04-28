import { getEnv } from '@/lib/utils/env';
import { createLogger } from '@/lib/utils/logger';
import { withRetry } from '@/lib/utils/retry';

const log = createLogger('telegram');

const API_BASE = 'https://api.telegram.org';

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  reply_to_message?: TelegramMessage;
}

export interface CallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: CallbackQuery;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface SendMessageOptions {
  chatId: number | string;
  text: string;
  parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  replyToMessageId?: number;
  inlineKeyboard?: InlineKeyboardButton[][];
  disableWebPagePreview?: boolean;
}

/**
 * Errors thrown for non-OK Telegram responses. Carries the HTTP status so
 * the retry predicate can distinguish 5xx (transient) from 4xx (permanent).
 * 4xx like 400 (bad payload) / 401/403 (auth) should never be retried —
 * they'll keep failing.
 */
class TelegramApiError extends Error {
  constructor(
    public readonly method: string,
    public readonly httpStatus: number,
    public readonly description: string | undefined
  ) {
    super(`Telegram API ${method} failed (HTTP ${httpStatus}): ${description}`);
  }
}

async function apiCall<T>(
  method: string,
  payload: Record<string, unknown>
): Promise<T> {
  const env = getEnv();
  const url = `${API_BASE}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
  return withRetry(
    async () => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        result?: T;
        description?: string;
      };
      if (!res.ok || !json.ok) {
        throw new TelegramApiError(method, res.status, json.description);
      }
      return json.result as T;
    },
    {
      attempts: 3,
      initialDelayMs: 300,
      maxDelayMs: 2500,
      label: `telegram:${method}`,
      shouldRetry: (err) => {
        if (err instanceof TelegramApiError) {
          return err.httpStatus >= 500 || err.httpStatus === 429;
        }
        // Network / DNS / fetch-thrown errors — retry once.
        return true;
      }
    }
  ).catch((err) => {
    if (err instanceof TelegramApiError) {
      log.error('telegram api error', {
        method: err.method,
        status: err.httpStatus,
        description: err.description
      });
    }
    throw err;
  });
}

export async function sendMessage(opts: SendMessageOptions): Promise<TelegramMessage> {
  const payload: Record<string, unknown> = {
    chat_id: opts.chatId,
    text: opts.text,
    disable_web_page_preview: opts.disableWebPagePreview ?? true
  };
  if (opts.parseMode) payload.parse_mode = opts.parseMode;
  if (opts.replyToMessageId) payload.reply_to_message_id = opts.replyToMessageId;
  if (opts.inlineKeyboard) {
    payload.reply_markup = { inline_keyboard: opts.inlineKeyboard };
  }
  return apiCall<TelegramMessage>('sendMessage', payload);
}

export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string
): Promise<void> {
  const payload: Record<string, unknown> = { callback_query_id: callbackQueryId };
  if (text) payload.text = text;
  await apiCall('answerCallbackQuery', payload);
}

export interface EditMessageOptions {
  chatId: number | string;
  messageId: number;
  text: string;
  parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  inlineKeyboard?: InlineKeyboardButton[][] | null;
  disableWebPagePreview?: boolean;
}

/**
 * Replace the text + (optionally) inline keyboard of an existing message.
 * Pass `inlineKeyboard: null` to remove the buttons entirely.
 */
export async function editMessageText(
  opts: EditMessageOptions
): Promise<TelegramMessage> {
  const payload: Record<string, unknown> = {
    chat_id: opts.chatId,
    message_id: opts.messageId,
    text: opts.text,
    disable_web_page_preview: opts.disableWebPagePreview ?? true
  };
  if (opts.parseMode) payload.parse_mode = opts.parseMode;
  if (opts.inlineKeyboard !== undefined) {
    payload.reply_markup =
      opts.inlineKeyboard === null
        ? { inline_keyboard: [] }
        : { inline_keyboard: opts.inlineKeyboard };
  }
  return apiCall<TelegramMessage>('editMessageText', payload);
}

export async function getMe(): Promise<TelegramUser> {
  return apiCall<TelegramUser>('getMe', {});
}

export function displayName(u: TelegramUser): string {
  if (u.username) return `@${u.username}`;
  return [u.first_name, u.last_name].filter(Boolean).join(' ');
}
