import { readRows, SHEETS } from './client';
import { createLogger } from '@/lib/utils/logger';
import type { TransactionRow } from './transactions';

const log = createLogger('investors');

export type InvestorRole = 'partner' | 'investor';

export interface Investor {
  id: string;
  name: string;
  tgId: number | null;
  role: InvestorRole;
  notes: string;
  joinedAt: string;
}

function parseRow(row: string[]): Investor | null {
  const id = String(row[0] ?? '');
  const name = String(row[1] ?? '');
  if (!id || !name) return null;
  const tgRaw = row[2];
  const tgNum =
    typeof tgRaw === 'number' ? tgRaw : Number(String(tgRaw ?? '').trim());
  const role = (String(row[3] ?? 'investor').toLowerCase() ||
    'investor') as InvestorRole;
  return {
    id,
    name,
    tgId: Number.isFinite(tgNum) && tgNum !== 0 ? tgNum : null,
    role: role === 'partner' ? 'partner' : 'investor',
    notes: String(row[8] ?? ''),
    joinedAt: String(row[9] ?? '')
  };
}

export async function listInvestors(): Promise<Investor[]> {
  const rows = await readRows(SHEETS.investors);
  const data = rows.map(parseRow).filter((i): i is Investor => i !== null);
  log.info('listInvestors', { count: data.length });
  return data;
}

export interface InvestorBalance {
  investor: Investor;
  totalDeposited: number;
  totalWithdrawn: number;
  currentShare: number;
}

/**
 * Compute per-investor cash balance by matching `counterparty` against
 * the investor's name. Considers all-time active deposits/withdrawals.
 *
 * Caveat: name-based matching is brittle — if the user types "田中" in
 * one entry and "田中さん" in another, they won't merge. The spec keeps
 * this manual; v2 could canonicalize via investor IDs in counterparty.
 */
export function computeInvestorBalances(
  investors: Investor[],
  txs: TransactionRow[]
): InvestorBalance[] {
  return investors.map((inv) => {
    let dep = 0;
    let wdr = 0;
    for (const t of txs) {
      if (t.status !== 'active') continue;
      if (t.counterparty !== inv.name) continue;
      if (t.type === 'deposit') dep += t.amount;
      else if (t.type === 'withdrawal') wdr += t.amount;
    }
    return {
      investor: inv,
      totalDeposited: dep,
      totalWithdrawn: wdr,
      currentShare: dep - wdr
    };
  });
}
