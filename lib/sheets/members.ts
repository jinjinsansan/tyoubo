import { readRows, SHEETS } from './client';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('members');

export type MemberRole = 'admin' | 'member' | 'viewer';

export interface Member {
  tgId: number;
  name: string;
  role: MemberRole;
  active: boolean;
  joinedAt: string;
}

let cache: { at: number; data: Member[] } | null = null;
const TTL_MS = 60_000;

function parseRow(row: string[]): Member | null {
  const tgId = Number(row[0]);
  if (!Number.isFinite(tgId)) return null;
  return {
    tgId,
    name: String(row[1] ?? ''),
    role: ((row[2] as MemberRole) || 'viewer') as MemberRole,
    active: String(row[3] ?? '').toLowerCase() === 'true',
    joinedAt: String(row[4] ?? '')
  };
}

export async function listMembers(force = false): Promise<Member[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const rows = await readRows(SHEETS.members);
  const members = rows
    .map(parseRow)
    .filter((m): m is Member => m !== null);
  cache = { at: Date.now(), data: members };
  log.info('listMembers', { count: members.length });
  return members;
}

export async function findMember(tgId: number): Promise<Member | null> {
  const members = await listMembers();
  return members.find((m) => m.tgId === tgId) ?? null;
}

/**
 * Authorization gate: returns the member if they are active, else null.
 * Used by Telegram handlers to reject unknown senders.
 */
export async function authorize(tgId: number): Promise<Member | null> {
  const m = await findMember(tgId);
  if (!m || !m.active) return null;
  return m;
}
