import { appendRow, SHEETS } from './client';
import { logAudit } from './audit';
import { newId, nowIso } from '@/lib/utils/id';
import { createLogger } from '@/lib/utils/logger';
import type { TxStatus, TxType } from '@/types/transaction';

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
