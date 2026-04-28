export const TX_TYPES = [
  'income',
  'expense',
  'fx_pnl',
  'deposit',
  'withdrawal',
  'transfer'
] as const;

export type TxType = (typeof TX_TYPES)[number];

export type TxStatus = 'active' | 'deleted';

export interface Transaction {
  id: string;
  createdAt: string;
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
  status: TxStatus;
  deletedAt: string;
  deletedBy: string;
  reviewFlag: boolean;
}

/**
 * Output shape of the LLM `record_transaction` tool call.
 * Mirrors §6.2 of the spec. `is_transaction=false` means the message
 * was a question/chat/empty-string and should not be recorded.
 */
export interface ParsedTransaction {
  is_transaction: boolean;
  tx_date?: string;
  type?: TxType;
  amount?: number;
  currency?: string;
  category?: string;
  counterparty?: string;
  memo?: string;
  review_flag?: boolean;
  review_reason?: string;
  confidence?: number;
}

export interface PendingTransaction {
  token: string;
  parsed: ParsedTransaction;
  sourceMessage: string;
  recordedByTgId: number;
  recordedByName: string;
  chatId: number | string;
  promptMessageId: number;
  createdAt: string;
}
