import type { CallbackQuery, TelegramMessage, TelegramUpdate } from './bot';
import {
  answerCallbackQuery,
  displayName,
  editMessageText,
  sendMessage
} from './bot';
import { dispatchCommand, parseCommand } from './commands';
import { renderConfirmCard, renderRecorded } from './format';
import { authorize } from '@/lib/sheets/members';
import { appendTransaction } from '@/lib/sheets/transactions';
import { logAudit } from '@/lib/sheets/audit';
import { SHEETS } from '@/lib/sheets/client';
import { parseTransaction } from '@/lib/llm/parse-transaction';
import { answerQuery } from '@/lib/llm/answer-query';
import {
  deletePending,
  getPending,
  savePending
} from '@/lib/utils/pending';
import { newToken, nowIso } from '@/lib/utils/id';
import { isAllowedChat } from '@/lib/utils/env';
import { createLogger } from '@/lib/utils/logger';
import type { ParsedTransaction, PendingTransaction, TxType } from '@/types/transaction';

const log = createLogger('handler');

const REQUIRED_FOR_RECORD: Array<keyof ParsedTransaction> = [
  'tx_date',
  'type',
  'amount'
];

const CALLBACK_PREFIX = 'kb:';
type CallbackAction = 'c' | 'x'; // confirm / cancel

export async function handleUpdate(update: TelegramUpdate): Promise<void> {
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return;
  }
  if (update.message) {
    await handleMessage(update.message);
    return;
  }
  log.debug('skip non-message update', { update_id: update.update_id });
}

// ─── Message dispatch ─────────────────────────────────────────────────

async function handleMessage(msg: TelegramMessage): Promise<void> {
  if (!msg.text || !msg.from) return;

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
      log.error('command crashed', {
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

  await handleFreeFormMessage(msg);
}

// ─── Free-form natural-language entry ─────────────────────────────────

async function handleFreeFormMessage(msg: TelegramMessage): Promise<void> {
  const fromId = msg.from!.id;
  const member = await authorize(fromId);
  if (!member) {
    await sendMessage({
      chatId: msg.chat.id,
      text: 'membersシートに登録されていません。管理者に追加を依頼してください。',
      replyToMessageId: msg.message_id
    });
    return;
  }

  let parsed: ParsedTransaction;
  try {
    const result = await parseTransaction(msg.text!);
    parsed = result.parsed;
  } catch (err) {
    log.error('LLM parse failed', {
      err: err instanceof Error ? err.message : String(err)
    });
    await sendMessage({
      chatId: msg.chat.id,
      text:
        '現在AIが応答できません。少し時間を置いて再度お試しください。\n例: 「広告費5000円」「FX +3万」「田中さんから50万入金」',
      replyToMessageId: msg.message_id
    });
    return;
  }

  if (!parsed.is_transaction) {
    // Free-form question or chat. Hand off to the query LLM with sheet context.
    try {
      const result = await answerQuery(msg.text!);
      await sendMessage({
        chatId: msg.chat.id,
        text: result.answer,
        replyToMessageId: msg.message_id
      });
    } catch (err) {
      log.error('answerQuery failed', {
        err: err instanceof Error ? err.message : String(err)
      });
      await sendMessage({
        chatId: msg.chat.id,
        text:
          '回答できませんでした。記帳は「広告費5000円」のように、照会は「今月の利益は？」のように送ってください。コマンドは /help。',
        replyToMessageId: msg.message_id
      });
    }
    return;
  }

  const missing = REQUIRED_FOR_RECORD.filter((k) => parsed[k] === undefined);
  if (missing.length > 0) {
    await sendMessage({
      chatId: msg.chat.id,
      text: `必要な情報が不足しています: ${missing.join(', ')}\n例: 「広告費5000円」のように金額と内容をセットで送ってください。`,
      replyToMessageId: msg.message_id
    });
    return;
  }

  const token = newToken();
  const card = renderConfirmCard(parsed);

  // Send the card first so we can capture the prompt message id, then
  // attach pending state. We accept the small race where a user could
  // tap before the pending entry lands — getPending() will return null
  // and the callback will reply "expired or invalid".
  const promptMessage = await sendMessage({
    chatId: msg.chat.id,
    text: card,
    replyToMessageId: msg.message_id,
    inlineKeyboard: [
      [
        { text: '✅ 記帳', callback_data: `${CALLBACK_PREFIX}c:${token}` },
        { text: '❌ キャンセル', callback_data: `${CALLBACK_PREFIX}x:${token}` }
      ]
    ]
  });

  const pending: PendingTransaction = {
    token,
    parsed,
    sourceMessage: msg.text!,
    recordedByTgId: fromId,
    recordedByName: member.name || displayName(msg.from!),
    chatId: msg.chat.id,
    promptMessageId: promptMessage.message_id,
    createdAt: nowIso()
  };
  await savePending(pending);
}

// ─── Callback query (✅ / ❌) ─────────────────────────────────────────

async function handleCallbackQuery(cb: CallbackQuery): Promise<void> {
  if (!cb.data || !cb.data.startsWith(CALLBACK_PREFIX)) {
    await answerCallbackQuery(cb.id);
    return;
  }
  const tail = cb.data.slice(CALLBACK_PREFIX.length);
  const sep = tail.indexOf(':');
  if (sep === -1) {
    await answerCallbackQuery(cb.id);
    return;
  }
  const action = tail.slice(0, sep) as CallbackAction;
  const token = tail.slice(sep + 1);

  if (cb.message && !isAllowedChat(cb.message.chat.id)) {
    log.warn('callback from disallowed chat', { chat_id: cb.message.chat.id });
    await answerCallbackQuery(cb.id);
    return;
  }

  const member = await authorize(cb.from.id);
  if (!member) {
    await answerCallbackQuery(cb.id, '権限がありません');
    return;
  }

  const pending = await getPending(token);
  if (!pending) {
    await answerCallbackQuery(cb.id, 'この確認は期限切れです');
    if (cb.message) {
      await editMessageText({
        chatId: cb.message.chat.id,
        messageId: cb.message.message_id,
        text: '⌛ 確認の有効期限が切れました（5分）。もう一度メッセージを送ってください。',
        inlineKeyboard: null
      }).catch(() => undefined);
    }
    return;
  }

  if (pending.recordedByTgId !== cb.from.id) {
    await answerCallbackQuery(cb.id, '記帳者本人のみ操作できます');
    return;
  }

  if (action === 'x') {
    await deletePending(token);
    await answerCallbackQuery(cb.id, 'キャンセルしました');
    if (cb.message) {
      await editMessageText({
        chatId: cb.message.chat.id,
        messageId: cb.message.message_id,
        text: '🚫 キャンセルしました',
        inlineKeyboard: null
      }).catch(() => undefined);
    }
    return;
  }

  if (action === 'c') {
    await confirmAndRecord(cb, pending);
    return;
  }

  await answerCallbackQuery(cb.id);
}

async function confirmAndRecord(
  cb: CallbackQuery,
  pending: PendingTransaction
): Promise<void> {
  const p = pending.parsed;
  const tx_date = p.tx_date!;
  const type = p.type as TxType;
  const amount = p.amount!;

  try {
    const tx = await appendTransaction({
      txDate: tx_date,
      type,
      amount,
      currency: p.currency ?? 'JPY',
      category: p.category ?? '',
      counterparty: p.counterparty ?? '',
      memo: p.memo ?? '',
      recordedByTgId: pending.recordedByTgId,
      recordedByName: pending.recordedByName,
      sourceMessage: pending.sourceMessage,
      reviewFlag: !!p.review_flag
    });

    await deletePending(pending.token);
    await answerCallbackQuery(cb.id, '記帳しました');
    if (cb.message) {
      await editMessageText({
        chatId: cb.message.chat.id,
        messageId: cb.message.message_id,
        text: renderRecorded(p, tx.id),
        inlineKeyboard: null
      }).catch(() => undefined);
    }
  } catch (err) {
    log.error('record failed', {
      token: pending.token,
      err: err instanceof Error ? err.message : String(err)
    });
    // Best-effort: leave the pending entry so the user can retry. We log
    // a query-style audit so we have a paper trail of the failure attempt.
    await logAudit({
      action: 'create',
      targetTable: SHEETS.transactions,
      targetId: pending.token,
      before: null,
      after: { error: err instanceof Error ? err.message : String(err) },
      actorTgId: pending.recordedByTgId,
      actorName: pending.recordedByName,
      source: 'telegram'
    }).catch(() => undefined);

    await answerCallbackQuery(cb.id, '記帳に失敗しました');
    if (cb.message) {
      await editMessageText({
        chatId: cb.message.chat.id,
        messageId: cb.message.message_id,
        text: '⚠️ 記帳に失敗しました。もう一度メッセージを送り直してください。',
        inlineKeyboard: null
      }).catch(() => undefined);
    }
  }
}
