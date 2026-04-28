import type { TelegramUpdate } from './bot';
import { sendMessage } from './bot';
import { dispatchCommand, parseCommand } from './commands';
import { isAllowedChat } from '@/lib/utils/env';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('handler');

/**
 * Top-level entry for an incoming Telegram update.
 * Sprint 1: only command handling. Free-form parsing arrives in Sprint 2.
 */
export async function handleUpdate(update: TelegramUpdate): Promise<void> {
  if (!update.message) {
    log.debug('skip non-message update', { update_id: update.update_id });
    return;
  }

  const msg = update.message;
  if (!msg.text || !msg.from) return;

  // Reject messages from outside the allowed group/private chat with the bot owner.
  if (!isAllowedChat(msg.chat.id)) {
    log.warn('chat not allowed', {
      chat_id: msg.chat.id,
      from: msg.from.id,
      text_preview: msg.text.slice(0, 40)
    });
    return;
  }

  const cmd = parseCommand(msg.text);
  if (cmd) {
    try {
      await dispatchCommand({ message: msg, ...cmd });
    } catch (err) {
      log.error('command handler crashed', {
        command: cmd.command,
        err: err instanceof Error ? err.message : String(err)
      });
      await sendMessage({
        chatId: msg.chat.id,
        text: 'エラーが発生しました。もう一度お試しください。',
        replyToMessageId: msg.message_id
      });
    }
    return;
  }

  // Sprint 1: free-form input is acknowledged but not yet recorded.
  await sendMessage({
    chatId: msg.chat.id,
    text:
      '🚧 自然文の記帳は Sprint 2 で実装予定です。現在は `/whoami` `/help` のみ動作します。',
    parseMode: 'Markdown',
    replyToMessageId: msg.message_id
  });
}
