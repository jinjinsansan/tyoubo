import { appendRow, SHEETS, type SheetName } from './client';
import { newId, nowIso } from '@/lib/utils/id';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('audit');

export type AuditAction = 'create' | 'update' | 'delete' | 'query';
export type AuditSource = 'telegram' | 'web' | 'cron' | 'api';

export interface AuditEntry {
  action: AuditAction;
  targetTable: SheetName;
  targetId: string;
  before: unknown;
  after: unknown;
  actorTgId: number;
  actorName: string;
  source: AuditSource;
}

/**
 * Append a single audit row in the order defined by §2.6 of the spec.
 *
 * Fail-closed: callers that perform a write should call this BEFORE the
 * primary write so a Sheets API outage stops the transaction landing
 * without an audit trail. (See §9.5.)
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  const row: (string | number | boolean)[] = [
    newId(), // A: log_id
    nowIso(), // B: timestamp
    entry.actorTgId, // C: actor_tg_id
    entry.actorName, // D: actor_name
    entry.action, // E: action
    entry.targetTable, // F: target_table
    entry.targetId, // G: target_id
    safeStringify(entry.before), // H: before_value
    safeStringify(entry.after), // I: after_value
    entry.source // J: source
  ];

  await appendRow(SHEETS.auditLog, row);
  log.info('logged', {
    action: entry.action,
    table: entry.targetTable,
    target: entry.targetId,
    actor: entry.actorTgId
  });
}

function safeStringify(v: unknown): string {
  if (v === null || v === undefined) return '';
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
