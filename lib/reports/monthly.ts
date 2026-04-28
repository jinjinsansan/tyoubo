import { appendRow, readRows, SHEETS } from '@/lib/sheets/client';
import { listActiveTransactions } from '@/lib/sheets/transactions';
import {
  computeInvestorBalances,
  listInvestors,
  type InvestorBalance
} from '@/lib/sheets/investors';
import {
  computeBalance,
  computeMonthly,
  type MonthlySummary
} from '@/lib/reports/aggregate';
import { sendMessage } from '@/lib/telegram/bot';
import { formatYen } from '@/lib/telegram/format';
import { getEnv } from '@/lib/utils/env';
import {
  formatYearMonthJa,
  lastDayOfMonthIso,
  previousYearMonthJst
} from '@/lib/utils/id';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('monthly-report');

export interface GenerateMonthlyReportInput {
  /** YYYY-MM. Defaults to the previous calendar month in JST. */
  yearMonth?: string;
  /** When true, emit even if monthly_summary already has a row for this month. */
  force?: boolean;
}

export interface GenerateMonthlyReportResult {
  yearMonth: string;
  alreadyReported: boolean;
  summary: MonthlySummary | null;
  eomBalanceJpy: number;
  investorBalances: InvestorBalance[];
  telegramMessageId: number | null;
  reportText: string;
}

function formatSignedYen(n: number): string {
  if (n === 0) return '¥0';
  return n > 0 ? `+${formatYen(n)}` : `-${formatYen(Math.abs(n))}`;
}

function spreadsheetUrl(): string {
  return `https://docs.google.com/spreadsheets/d/${getEnv().GOOGLE_SHEETS_ID}`;
}

function buildReportText(
  yearMonth: string,
  m: MonthlySummary,
  eomJpy: number,
  balances: InvestorBalance[]
): string {
  const lines: string[] = [];
  lines.push(`📊 ${formatYearMonthJa(yearMonth)} 運用レポート`);
  lines.push('');
  lines.push('【収支】');
  lines.push(`収入合計: ${formatYen(m.totalIncome)}`);
  lines.push(`経費合計: ${formatYen(m.totalExpense)}`);
  lines.push(`FX損益: ${formatSignedYen(m.fxPnlNet)}`);
  lines.push('');
  lines.push(`純損益: ${formatSignedYen(m.netProfit)}`);
  lines.push('');
  lines.push('【入出金】');
  lines.push(`出資受入: ${formatYen(m.depositsIn)}`);
  lines.push(`分配・返金: ${formatYen(m.withdrawalsOut)}`);
  lines.push('');
  lines.push('【月末残高】');
  lines.push(`合計: ${formatSignedYen(eomJpy)}`);

  // Investors with non-zero share, sorted desc.
  const nonZero = balances
    .filter((b) => b.currentShare !== 0)
    .sort((a, b) => b.currentShare - a.currentShare);
  if (nonZero.length > 0) {
    lines.push('');
    lines.push('【出資者別残高】');
    for (const b of nonZero) {
      const role = b.investor.role === 'partner' ? '(仲間)' : '';
      lines.push(`- ${b.investor.name}${role}: ${formatYen(b.currentShare)}`);
    }
  }

  lines.push('');
  lines.push(`記帳件数: ${m.count} 件`);
  lines.push('');
  lines.push(`詳細: ${spreadsheetUrl()}`);
  return lines.join('\n');
}

async function existingMonthlyRow(yearMonth: string): Promise<boolean> {
  const rows = await readRows(SHEETS.monthlySummary);
  return rows.some((r) => String(r[0] ?? '') === yearMonth);
}

/**
 * Build and (when not yet reported) emit the monthly report:
 *   1. Pulls active transactions
 *   2. Computes month aggregate, EOM cumulative balance, per-investor balances
 *   3. Posts to the Telegram group
 *   4. Appends a row to monthly_summary
 *
 * Order matters: Telegram post first, then sheet append. If Telegram fails
 * we want the run to fail loudly so a retry will produce both. If sheet
 * append fails after the post lands, the next retry will skip the post
 * thanks to the existence check (idempotent at the month level).
 */
export async function generateMonthlyReport(
  input: GenerateMonthlyReportInput = {}
): Promise<GenerateMonthlyReportResult> {
  const yearMonth = input.yearMonth ?? previousYearMonthJst();
  log.info('start', { yearMonth, force: !!input.force });

  if (!input.force && (await existingMonthlyRow(yearMonth))) {
    log.warn('monthly_summary already has a row, skipping', { yearMonth });
    return {
      yearMonth,
      alreadyReported: true,
      summary: null,
      eomBalanceJpy: 0,
      investorBalances: [],
      telegramMessageId: null,
      reportText: ''
    };
  }

  const allActive = await listActiveTransactions();
  const summary = computeMonthly(allActive, yearMonth);

  // EOM cumulative balance = signed sum of every active tx with txDate ≤ last day.
  const eomDate = lastDayOfMonthIso(yearMonth);
  const upToEom = allActive.filter((t) => t.txDate <= eomDate);
  const eomBalance = computeBalance(upToEom);

  const investors = await listInvestors();
  const balances = computeInvestorBalances(investors, allActive);

  const reportText = buildReportText(
    yearMonth,
    summary,
    eomBalance.totalJpy,
    balances
  );

  // Telegram first.
  const env = getEnv();
  const posted = await sendMessage({
    chatId: env.TELEGRAM_GROUP_ID,
    text: reportText
  });

  // Then monthly_summary row (§2.5 columns A..I).
  await appendRow(SHEETS.monthlySummary, [
    yearMonth,
    summary.totalIncome,
    summary.totalExpense,
    summary.fxPnlNet,
    summary.netProfit,
    summary.depositsIn,
    summary.withdrawalsOut,
    eomBalance.totalJpy,
    spreadsheetUrl()
  ]);

  log.info('done', {
    yearMonth,
    net: summary.netProfit,
    eom: eomBalance.totalJpy,
    msgId: posted.message_id
  });

  return {
    yearMonth,
    alreadyReported: false,
    summary,
    eomBalanceJpy: eomBalance.totalJpy,
    investorBalances: balances,
    telegramMessageId: posted.message_id,
    reportText
  };
}
