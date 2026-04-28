import type { ParsedTransaction, TxType } from '@/types/transaction';

const TYPE_LABEL: Record<TxType, string> = {
  income: '事業収入',
  expense: '経費',
  fx_pnl: 'FX損益',
  deposit: '投資家入金',
  withdrawal: '投資家分配',
  transfer: '内部移動'
};

export function formatYen(n: number, currency = 'JPY'): string {
  if (currency === 'JPY') return `¥${Math.round(n).toLocaleString('ja-JP')}`;
  return `${n.toLocaleString('ja-JP', { maximumFractionDigits: 2 })} ${currency}`;
}

export function typeLabel(t?: TxType): string {
  return t ? TYPE_LABEL[t] : '?';
}

/**
 * Build the confirmation card shown to the user before they tap ✅/❌.
 * Plain text — no Markdown — to avoid escaping pitfalls with user-supplied
 * memo / counterparty text (Telegram MarkdownV2 is unforgiving).
 */
export function renderConfirmCard(p: ParsedTransaction): string {
  const lines: string[] = ['📝 取引を以下で記帳しますか？', ''];
  lines.push(`日付: ${p.tx_date ?? '?'}`);
  lines.push(`種別: ${typeLabel(p.type)}`);
  if (p.amount !== undefined) {
    lines.push(`金額: ${formatYen(p.amount, p.currency ?? 'JPY')}`);
  }
  if (p.category) lines.push(`カテゴリ: ${p.category}`);
  if (p.counterparty) lines.push(`関係者: ${p.counterparty}`);
  if (p.memo) lines.push(`メモ: ${p.memo}`);
  if (typeof p.confidence === 'number') {
    lines.push(`信頼度: ${(p.confidence * 100).toFixed(0)}%`);
  }
  if (p.review_flag) {
    lines.push('');
    lines.push(`⚠️ 要確認: ${p.review_reason ?? '抽出に曖昧さがあります'}`);
  }
  return lines.join('\n');
}

export function renderRecorded(p: ParsedTransaction, txId: string): string {
  const lines: string[] = ['✅ 記帳しました'];
  lines.push(`日付: ${p.tx_date ?? '?'}`);
  lines.push(`種別: ${typeLabel(p.type)}`);
  if (p.amount !== undefined) {
    lines.push(`金額: ${formatYen(p.amount, p.currency ?? 'JPY')}`);
  }
  if (p.category) lines.push(`カテゴリ: ${p.category}`);
  if (p.counterparty) lines.push(`関係者: ${p.counterparty}`);
  if (p.memo) lines.push(`メモ: ${p.memo}`);
  lines.push('');
  lines.push(`id: ${txId}`);
  return lines.join('\n');
}
