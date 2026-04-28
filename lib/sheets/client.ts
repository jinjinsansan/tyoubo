import { google, sheets_v4 } from 'googleapis';
import { getEnv } from '@/lib/utils/env';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('sheets');

let cachedClient: sheets_v4.Sheets | null = null;

function buildClient(): sheets_v4.Sheets {
  const env = getEnv();
  const auth = new google.auth.JWT({
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  return google.sheets({ version: 'v4', auth });
}

export function getSheetsClient(): sheets_v4.Sheets {
  if (!cachedClient) cachedClient = buildClient();
  return cachedClient;
}

export const SHEETS = {
  transactions: 'transactions',
  investors: 'investors',
  categories: 'categories',
  wallets: 'wallets',
  monthlySummary: 'monthly_summary',
  auditLog: 'audit_log',
  members: 'members'
} as const;

export type SheetName = (typeof SHEETS)[keyof typeof SHEETS];

/**
 * Read all rows from a sheet (excluding the header row).
 * Returns string[][] of cell values.
 */
export async function readRows(
  sheet: SheetName,
  range = 'A2:Z'
): Promise<string[][]> {
  const env = getEnv();
  const client = getSheetsClient();
  const res = await client.spreadsheets.values.get({
    spreadsheetId: env.GOOGLE_SHEETS_ID,
    range: `${sheet}!${range}`,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING'
  });
  const rows = (res.data.values ?? []) as string[][];
  log.debug('readRows', { sheet, count: rows.length });
  return rows;
}

/**
 * Append a single row to the bottom of a sheet.
 * Values are sent as raw user-entered values (so dates etc. parse on the sheet side).
 */
export async function appendRow(
  sheet: SheetName,
  row: (string | number | boolean | null)[]
): Promise<void> {
  const env = getEnv();
  const client = getSheetsClient();
  await client.spreadsheets.values.append({
    spreadsheetId: env.GOOGLE_SHEETS_ID,
    range: `${sheet}!A:A`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row.map((v) => (v === null ? '' : v))] }
  });
  log.info('appendRow', { sheet, cols: row.length });
}

/**
 * Update a specific range in a sheet (e.g. "transactions!M5:O5").
 */
export async function updateRange(
  sheet: SheetName,
  a1Range: string,
  values: (string | number | boolean | null)[][]
): Promise<void> {
  const env = getEnv();
  const client = getSheetsClient();
  await client.spreadsheets.values.update({
    spreadsheetId: env.GOOGLE_SHEETS_ID,
    range: `${sheet}!${a1Range}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: values.map((r) => r.map((v) => (v === null ? '' : v))) }
  });
  log.info('updateRange', { sheet, a1Range, rows: values.length });
}

/**
 * Returns the header row of a sheet.
 */
export async function readHeader(sheet: SheetName): Promise<string[]> {
  const env = getEnv();
  const client = getSheetsClient();
  const res = await client.spreadsheets.values.get({
    spreadsheetId: env.GOOGLE_SHEETS_ID,
    range: `${sheet}!1:1`
  });
  return (res.data.values?.[0] ?? []) as string[];
}
