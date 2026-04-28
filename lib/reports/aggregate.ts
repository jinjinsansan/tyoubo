import type { TransactionRow } from '@/lib/sheets/transactions';

/** YYYY-MM in Asia/Tokyo. Use over `new Date()` to keep TZ deterministic. */
export function currentYearMonthJst(date = new Date()): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit'
  });
  return fmt.format(date);
}

export interface BalanceSummary {
  totalJpy: number;
  /** Per-currency net (excludes JPY which is captured in totalJpy). */
  byForeignCurrency: Record<string, number>;
  /** Count of active transactions considered. */
  count: number;
  /** Number of rows where review_flag was set — surface in /balance output. */
  reviewCount: number;
}

/**
 * Sign convention (§2.1 of the spec):
 *   income     → +amount
 *   expense    → -amount
 *   fx_pnl     → +amount if category=fx_profit, -amount if =fx_loss, else 0 (review)
 *   deposit    → +amount   (investor cash in)
 *   withdrawal → -amount   (investor cash out)
 *   transfer   → 0         (intra-pool, v1 single wallet)
 */
function signedAmount(tx: TransactionRow): number {
  switch (tx.type) {
    case 'income':
      return tx.amount;
    case 'expense':
      return -tx.amount;
    case 'fx_pnl':
      if (tx.category === 'fx_profit') return tx.amount;
      if (tx.category === 'fx_loss') return -tx.amount;
      return 0;
    case 'deposit':
      return tx.amount;
    case 'withdrawal':
      return -tx.amount;
    case 'transfer':
      return 0;
    default:
      return 0;
  }
}

export function computeBalance(txs: TransactionRow[]): BalanceSummary {
  let totalJpy = 0;
  const byForeign: Record<string, number> = {};
  let reviewCount = 0;

  for (const tx of txs) {
    if (tx.status !== 'active') continue;
    if (tx.reviewFlag) reviewCount++;
    const signed = signedAmount(tx);
    if (signed === 0) continue;
    if (tx.currency === 'JPY' || !tx.currency) {
      totalJpy += signed;
    } else {
      byForeign[tx.currency] = (byForeign[tx.currency] ?? 0) + signed;
    }
  }
  return {
    totalJpy: Math.round(totalJpy),
    byForeignCurrency: byForeign,
    count: txs.length,
    reviewCount
  };
}

export interface MonthlySummary {
  yearMonth: string;
  totalIncome: number;
  totalExpense: number;
  fxProfit: number;
  fxLoss: number;
  fxPnlNet: number;
  depositsIn: number;
  withdrawalsOut: number;
  netProfit: number;
  count: number;
}

const ZERO_MONTHLY = (yearMonth: string): MonthlySummary => ({
  yearMonth,
  totalIncome: 0,
  totalExpense: 0,
  fxProfit: 0,
  fxLoss: 0,
  fxPnlNet: 0,
  depositsIn: 0,
  withdrawalsOut: 0,
  netProfit: 0,
  count: 0
});

/**
 * Filter is by tx_date prefix (e.g. "2026-04"), so it follows the user's
 * declared transaction date rather than wall-clock createdAt. The two can
 * disagree when a user back-dates an entry.
 *
 * Multi-currency note: the JPY-denominated sums silently include foreign
 * currency amounts — for v1 this is acceptable since spec §1 makes manual
 * entry of FX rates the user's responsibility. v2 will normalize.
 */
export function computeMonthly(
  txs: TransactionRow[],
  yearMonth: string
): MonthlySummary {
  const out = ZERO_MONTHLY(yearMonth);
  for (const tx of txs) {
    if (tx.status !== 'active') continue;
    if (!tx.txDate.startsWith(yearMonth)) continue;
    out.count++;
    switch (tx.type) {
      case 'income':
        out.totalIncome += tx.amount;
        break;
      case 'expense':
        out.totalExpense += tx.amount;
        break;
      case 'fx_pnl':
        if (tx.category === 'fx_profit') out.fxProfit += tx.amount;
        else if (tx.category === 'fx_loss') out.fxLoss += tx.amount;
        break;
      case 'deposit':
        out.depositsIn += tx.amount;
        break;
      case 'withdrawal':
        out.withdrawalsOut += tx.amount;
        break;
      case 'transfer':
        break;
    }
  }
  out.fxPnlNet = out.fxProfit - out.fxLoss;
  out.netProfit = out.totalIncome - out.totalExpense + out.fxPnlNet;
  return out;
}

export function filterByDate(
  txs: TransactionRow[],
  isoDate: string
): TransactionRow[] {
  return txs.filter((t) => t.status === 'active' && t.txDate === isoDate);
}

export function filterByMonth(
  txs: TransactionRow[],
  yearMonth: string
): TransactionRow[] {
  return txs.filter(
    (t) => t.status === 'active' && t.txDate.startsWith(yearMonth)
  );
}
