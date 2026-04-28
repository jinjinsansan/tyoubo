import { appendRow, readRows, SHEETS, updateRange } from './client';
import { logAudit } from './audit';
import { newId, nowIso } from '@/lib/utils/id';
import { createLogger } from '@/lib/utils/logger';
import { TX_TYPES, type TxStatus, type TxType } from '@/types/transaction';

const log = createLogger('tx');

export interface NewTransactionInput {
  txDate: string;
  type: TxType;
  amount: number;
  currency: string;
  category: string;
  counterparty: string;
  memo: string;
  recordedByTgId: number;
  recordedByName: string;
  sourceMessage: string;
  reviewFlag: boolean;
}

export interface CreatedTransaction extends NewTransactionInput {
  id: string;
  createdAt: string;
  status: TxStatus;
  deletedAt: string;
  deletedBy: string;
}

/**
 * Append a transaction row in the order defined by §2.1 of the spec
 * (columns A..P). Order is load-bearing — if the spec sheet ever
 * adds/reorders columns this must change in lockstep.
 */
export async function appendTransaction(
  input: NewTransactionInput
): Promise<CreatedTransaction> {
  const tx: CreatedTransaction = {
    ...input,
    id: newId(),
    createdAt: nowIso(),
    status: 'active',
    deletedAt: '',
    deletedBy: ''
  };

  const row: (string | number | boolean)[] = [
    tx.id, // A: id
    tx.createdAt, // B: created_at
    tx.txDate, // C: tx_date
    tx.type, // D: type
    tx.amount, // E: amount
    tx.currency, // F: currency
    tx.category, // G: category
    tx.counterparty, // H: counterparty
    tx.memo, // I: memo
    tx.recordedByTgId, // J: recorded_by_tg_id
    tx.recordedByName, // K: recorded_by_name
    tx.sourceMessage, // L: source_message
    tx.status, // M: status
    tx.deletedAt, // N: deleted_at
    tx.deletedBy, // O: deleted_by
    tx.reviewFlag // P: review_flag
  ];

  // Audit FIRST (fail-closed). If the audit log can't be written we abort
  // before the transaction lands, matching §9.5 of the spec. We log it as
  // pending in the audit_log itself so a later success update is possible
  // — but if even the pending log fails we propagate the error.
  await logAudit({
    action: 'create',
    targetTable: SHEETS.transactions,
    targetId: tx.id,
    before: null,
    after: tx,
    actorTgId: tx.recordedByTgId,
    actorName: tx.recordedByName,
    source: 'telegram'
  });

  await appendRow(SHEETS.transactions, row);
  log.info('append', {
    id: tx.id,
    type: tx.type,
    amount: tx.amount,
    review: tx.reviewFlag
  });
  return tx;
}

// ─── Read paths ─────────────────────────────────────────────────────

export interface TransactionRow extends CreatedTransaction {
  /** 1-based row number in the sheet (header at 1, data starts at 2). */
  rowIndex: number;
}

const TX_TYPE_SET = new Set<string>(TX_TYPES);

/**
 * Sheets API trims trailing empty cells per row, so a row with empty
 * deleted_at / deleted_by / review_flag may be returned shorter than 16
 * cells. Always index defensively.
 */
function parseRow(row: string[], idx: number): TransactionRow | null {
  const id = String(row[0] ?? '');
  if (!id) return null;
  const typeStr = String(row[3] ?? '');
  if (!TX_TYPE_SET.has(typeStr)) return null;

  const amountRaw = row[4];
  const amount =
    typeof amountRaw === 'number'
      ? amountRaw
      : Number(String(amountRaw ?? '0').replace(/,/g, ''));
  if (!Number.isFinite(amount)) return null;

  const status = (String(row[12] ?? 'active') || 'active') as TxStatus;
  const recordedByRaw = row[9];
  const recordedByTgId =
    typeof recordedByRaw === 'number'
      ? recordedByRaw
      : Number(recordedByRaw ?? 0);

  // valueRenderOption=UNFORMATTED_VALUE returns booleans as strings here
  // (the row[] is typed as string[]). We accept "TRUE" / "true" / "1".
  const reviewRaw = String(row[15] ?? '').toLowerCase();
  const reviewFlag = reviewRaw === 'true' || reviewRaw === '1';

  return {
    id,
    createdAt: String(row[1] ?? ''),
    txDate: String(row[2] ?? ''),
    type: typeStr as TxType,
    amount,
    currency: String(row[5] ?? 'JPY') || 'JPY',
    category: String(row[6] ?? ''),
    counterparty: String(row[7] ?? ''),
    memo: String(row[8] ?? ''),
    recordedByTgId: Number.isFinite(recordedByTgId) ? recordedByTgId : 0,
    recordedByName: String(row[10] ?? ''),
    sourceMessage: String(row[11] ?? ''),
    status,
    deletedAt: String(row[13] ?? ''),
    deletedBy: String(row[14] ?? ''),
    reviewFlag,
    rowIndex: idx + 2
  };
}

export async function listAllTransactions(): Promise<TransactionRow[]> {
  const rows = await readRows(SHEETS.transactions);
  return rows
    .map((r, i) => parseRow(r, i))
    .filter((r): r is TransactionRow => r !== null);
}

export async function listActiveTransactions(): Promise<TransactionRow[]> {
  const all = await listAllTransactions();
  return all.filter((t) => t.status === 'active');
}

/** Most recent active transaction recorded by the given Telegram user. */
export async function findLastActiveByActor(
  tgId: number
): Promise<TransactionRow | null> {
  const active = await listActiveTransactions();
  return (
    active
      .filter((t) => t.recordedByTgId === tgId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  );
}

// ─── Logical delete ────────────────────────────────────────────────

export interface DeletedActor {
  tgId: number;
  name: string;
}

export async function markTransactionDeleted(
  tx: TransactionRow,
  actor: DeletedActor
): Promise<void> {
  const deletedAt = nowIso();
  const after: CreatedTransaction = {
    ...tx,
    status: 'deleted',
    deletedAt,
    deletedBy: actor.name
  };
  // Strip rowIndex from the audit before-image — it's an internal helper,
  // not part of the canonical transaction shape.
  const { rowIndex: _rowIndex, ...beforeForAudit } = tx;
  void _rowIndex;

  // Fail-closed: audit first, mutation second.
  await logAudit({
    action: 'delete',
    targetTable: SHEETS.transactions,
    targetId: tx.id,
    before: beforeForAudit,
    after,
    actorTgId: actor.tgId,
    actorName: actor.name,
    source: 'telegram'
  });

  // Columns M..O = status, deleted_at, deleted_by (§2.1).
  await updateRange(
    SHEETS.transactions,
    `M${tx.rowIndex}:O${tx.rowIndex}`,
    [['deleted', deletedAt, actor.name]]
  );
  log.info('marked deleted', { id: tx.id, by: actor.tgId });
}
