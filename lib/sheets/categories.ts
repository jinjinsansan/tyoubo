import { readRows, SHEETS } from './client';
import type { CategoryRow } from '@/lib/llm/prompts';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('categories');

const TTL_MS = 5 * 60_000;
let cache: { at: number; data: CategoryRow[] } | null = null;

function parseRow(row: string[]): CategoryRow | null {
  const [categoryId, categoryName, txType, description] = row;
  if (!categoryId) return null;
  return {
    categoryId: String(categoryId),
    categoryName: String(categoryName ?? ''),
    txType: String(txType ?? ''),
    description: String(description ?? '')
  };
}

export async function listCategories(force = false): Promise<CategoryRow[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const rows = await readRows(SHEETS.categories);
  const data = rows
    .map(parseRow)
    .filter((c): c is CategoryRow => c !== null);
  cache = { at: Date.now(), data };
  log.info('listCategories', { count: data.length });
  return data;
}

/**
 * Returns the set of valid category_ids — used to validate LLM output before
 * we trust a write. Unknown categories should fall back to misc_expense and
 * trigger a review_flag.
 */
export async function categoryIdSet(): Promise<Set<string>> {
  const cats = await listCategories();
  return new Set(cats.map((c) => c.categoryId));
}
