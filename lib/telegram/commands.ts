import type { TelegramMessage } from './bot';
import { displayName, sendMessage } from './bot';
import { formatYen, typeLabel } from './format';
import { authorize, findMember, type Member } from '@/lib/sheets/members';
import {
  findLastActiveByActor,
  listActiveTransactions,
  markTransactionDeleted,
  type TransactionRow
} from '@/lib/sheets/transactions';
import {
  computeBalance,
  computeMonthly,
  currentYearMonthJst,
  filterByDate
} from '@/lib/reports/aggregate';
import { todayJst } from '@/lib/utils/id';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('cmd');

export interface CommandContext {
  message: TelegramMessage;
  command: string;
  args: string[];
}

export function parseCommand(text: string): { command: string; args: string[] } | null {
  if (!text.startsWith('/')) return null;
  const stripped = text.slice(1).trim();
  if (!stripped) return null;
  const [head, ...rest] = stripped.split(/\s+/);
  const command = head.split('@')[0].toLowerCase();
  return { command, args: rest };
}

// ─── /whoami /help ────────────────────────────────────────────────

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
    '*記帳* (自然文)',
    '`広告費5000円` / `FX +3万` / `田中さんから50万入金` を送ると、',
    'AIが解釈して確認カードを返します。✅で記帳、❌でキャンセル。',
    '',
    '*照会* (自然文 or コマンド)',
    '`今月の利益は？` のように質問すると集計を答えます。',
    '`/balance` — 現在残高 + 今月集計',
    '`/today`   — 今日の取引一覧',
    '`/month`   — 今月のサマリー',
    '`/list [n]` — 直近 n 件 (デフォルト10、最大50)',
    '`/undo`    — 自分の最後の記帳を論理削除',
    '',
    '*ユーティリティ*',
    '`/whoami` — 自分のtg_idと権限',
    '`/help`   — このヘルプ'
  ].join('\n');
  await sendMessage({
    chatId: ctx.message.chat.id,
    text,
    parseMode: 'Markdown',
    replyToMessageId: ctx.message.message_id
  });
}

// ─── Aggregation commands ─────────────────────────────────────────

function formatTxLine(tx: TransactionRow): string {
  const amt = formatYen(tx.amount, tx.currency || 'JPY');
  const tag = typeLabel(tx.type);
  const cat = tx.category ? ` [${tx.category}]` : '';
  const cp = tx.counterparty ? ` ${tx.counterparty}` : '';
  const memo = tx.memo ? ` — ${tx.memo}` : '';
  const review = tx.reviewFlag ? ' ⚠️' : '';
  return `• ${tx.txDate}  ${tag}  ${amt}${cat}${cp}${memo}${review}`;
}

async function cmdBalance(_ctx: CommandContext): Promise<string> {
  const txs = await listActiveTransactions();
  const ym = currentYearMonthJst();
  const balance = computeBalance(txs);
  const month = computeMonthly(txs, ym);

  const lines: string[] = [];
  lines.push('🪙 残高 (現在)');
  lines.push(`合計 (JPY): ${formatYen(balance.totalJpy)}`);
  for (const [cur, val] of Object.entries(balance.byForeignCurrency)) {
    lines.push(`${cur}: ${val.toLocaleString('ja-JP', { maximumFractionDigits: 2 })}`);
  }
  lines.push(`記帳件数: ${balance.count} 件`);
  if (balance.reviewCount > 0) {
    lines.push(`⚠️ 要確認の記帳: ${balance.reviewCount} 件`);
  }
  lines.push('');
  lines.push(`📅 ${ym} の集計`);
  lines.push(`収入: ${formatYen(month.totalIncome)}`);
  lines.push(`経費: ${formatYen(month.totalExpense)}`);
  lines.push(`FX損益: ${formatSignedYen(month.fxPnlNet)}`);
  lines.push(`純損益: ${formatSignedYen(month.netProfit)}`);
  lines.push(`出資受入: ${formatYen(month.depositsIn)}`);
  lines.push(`分配・返金: ${formatYen(month.withdrawalsOut)}`);
  return lines.join('\n');
}

function formatSignedYen(n: number): string {
  if (n === 0) return '¥0';
  const sign = n > 0 ? '+' : '-';
  return `${sign}${formatYen(Math.abs(n))}`;
}

async function cmdToday(_ctx: CommandContext): Promise<string> {
  const txs = await listActiveTransactions();
  const today = todayJst();
  const todays = filterByDate(txs, today);
  if (todays.length === 0) {
    return `📅 ${today}\n本日の記帳はまだありません。`;
  }
  const lines: string[] = [`📅 ${today} の取引 (${todays.length}件)`];
  for (const tx of todays) lines.push(formatTxLine(tx));
  return lines.join('\n');
}

async function cmdMonth(_ctx: CommandContext): Promise<string> {
  const txs = await listActiveTransactions();
  const ym = currentYearMonthJst();
  const month = computeMonthly(txs, ym);

  const lines: string[] = [`📊 ${ym} 月次サマリー`];
  lines.push('');
  lines.push('【収支】');
  lines.push(`収入合計: ${formatYen(month.totalIncome)}`);
  lines.push(`経費合計: ${formatYen(month.totalExpense)}`);
  lines.push(`FX利益: ${formatYen(month.fxProfit)}`);
  lines.push(`FX損失: ${formatYen(month.fxLoss)}`);
  lines.push(`FX損益(差): ${formatSignedYen(month.fxPnlNet)}`);
  lines.push('');
  lines.push(`純損益: ${formatSignedYen(month.netProfit)}`);
  lines.push('');
  lines.push('【入出金】');
  lines.push(`出資受入: ${formatYen(month.depositsIn)}`);
  lines.push(`分配・返金: ${formatYen(month.withdrawalsOut)}`);
  lines.push('');
  lines.push(`記帳件数: ${month.count} 件`);
  return lines.join('\n');
}

async function cmdList(ctx: CommandContext): Promise<string> {
  const raw = ctx.args[0];
  const n = raw ? Number.parseInt(raw, 10) : 10;
  const cap = Number.isFinite(n) ? Math.min(Math.max(n, 1), 50) : 10;

  const txs = await listActiveTransactions();
  const recent = txs
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, cap);

  if (recent.length === 0) return '記帳はまだありません。';

  const lines: string[] = [`🗒 直近 ${recent.length} 件 (新→旧)`];
  for (const tx of recent) lines.push(formatTxLine(tx));
  return lines.join('\n');
}

async function cmdUndo(ctx: CommandContext, member: Member): Promise<string> {
  const fromId = ctx.message.from!.id;
  const last = await findLastActiveByActor(fromId);
  if (!last) {
    return '取り消せる記帳が見つかりません（自分が記帳した active なものが対象）。';
  }
  await markTransactionDeleted(last, {
    tgId: fromId,
    name: member.name || displayName(ctx.message.from!)
  });
  const amt = formatYen(last.amount, last.currency || 'JPY');
  return [
    '↩️ 取り消しました',
    `日付: ${last.txDate}`,
    `種別: ${typeLabel(last.type)}`,
    `金額: ${amt}`,
    last.category ? `カテゴリ: ${last.category}` : '',
    `id: ${last.id}`
  ]
    .filter(Boolean)
    .join('\n');
}

// ─── Dispatcher ───────────────────────────────────────────────────

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

  let body: string;
  try {
    switch (ctx.command) {
      case 'balance':
        body = await cmdBalance(ctx);
        break;
      case 'today':
        body = await cmdToday(ctx);
        break;
      case 'month':
        body = await cmdMonth(ctx);
        break;
      case 'list':
        body = await cmdList(ctx);
        break;
      case 'undo':
        body = await cmdUndo(ctx, member);
        break;
      default:
        body = `\`/${ctx.command}\` は未実装のコマンドです。/help を参照。`;
    }
  } catch (err) {
    log.error('command failed', {
      command: ctx.command,
      err: err instanceof Error ? err.message : String(err)
    });
    body = '⚠️ 処理中にエラーが発生しました。Sheetsへの接続を確認してください。';
  }

  await sendMessage({
    chatId: ctx.message.chat.id,
    text: body,
    replyToMessageId: ctx.message.message_id
  });
  return true;
}
