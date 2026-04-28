import type { TelegramMessage } from './bot';
import { displayName, sendMessage } from './bot';
import { authorize, findMember } from '@/lib/sheets/members';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('cmd');

export interface CommandContext {
  message: TelegramMessage;
  command: string;
  args: string[];
}

/**
 * Parses the leading slash command from a message.
 * Returns null when the text is not a command.
 */
export function parseCommand(text: string): { command: string; args: string[] } | null {
  if (!text.startsWith('/')) return null;
  const stripped = text.slice(1).trim();
  if (!stripped) return null;
  const [head, ...rest] = stripped.split(/\s+/);
  // Strip "@botname" suffix used in groups
  const command = head.split('@')[0].toLowerCase();
  return { command, args: rest };
}

async function cmdWhoami(ctx: CommandContext): Promise<void> {
  const from = ctx.message.from;
  if (!from) return;
  const member = await findMember(from.id);
  const lines: string[] = [];
  lines.push('🪪 *whoami*');
  lines.push(`name: ${displayName(from)}`);
  lines.push(`tg_id: \`${from.id}\``);
  if (member) {
    lines.push(`role: ${member.role}`);
    lines.push(`active: ${member.active ? '✅' : '❌'}`);
    lines.push(`registered_name: ${member.name}`);
  } else {
    lines.push('role: (未登録)');
    lines.push('active: ❌');
    lines.push('_membersシートに登録されていません_');
  }
  await sendMessage({
    chatId: ctx.message.chat.id,
    text: lines.join('\n'),
    parseMode: 'Markdown',
    replyToMessageId: ctx.message.message_id
  });
}

async function cmdHelp(ctx: CommandContext): Promise<void> {
  const text = [
    '*KumiBooks コマンド一覧*',
    '',
    '`/whoami` — 自分のtg_idと権限を表示',
    '`/help` — このヘルプ',
    '',
    '_Sprint 1 段階のため、記帳・照会コマンドは未実装です。_'
  ].join('\n');
  await sendMessage({
    chatId: ctx.message.chat.id,
    text,
    parseMode: 'Markdown',
    replyToMessageId: ctx.message.message_id
  });
}

/**
 * Dispatches a parsed command. Returns true if handled.
 *
 * /whoami is exempt from the members allowlist on purpose — non-members must be
 * able to discover their own tg_id so they can ask the admin to register them.
 */
export async function dispatchCommand(ctx: CommandContext): Promise<boolean> {
  log.info('dispatch', { command: ctx.command, from: ctx.message.from?.id });

  if (ctx.command === 'whoami') {
    await cmdWhoami(ctx);
    return true;
  }
  if (ctx.command === 'help') {
    await cmdHelp(ctx);
    return true;
  }

  // Other commands require active membership.
  const fromId = ctx.message.from?.id;
  if (!fromId) return false;
  const member = await authorize(fromId);
  if (!member) {
    await sendMessage({
      chatId: ctx.message.chat.id,
      text: 'membersシートに登録されていません。管理者に追加を依頼してください。',
      replyToMessageId: ctx.message.message_id
    });
    return true;
  }

  // Sprint 1 では他のコマンドは未実装
  await sendMessage({
    chatId: ctx.message.chat.id,
    text: `\`/${ctx.command}\` は Sprint 1 段階では未実装です。`,
    parseMode: 'Markdown',
    replyToMessageId: ctx.message.message_id
  });
  return true;
}
