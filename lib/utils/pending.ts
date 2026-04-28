import { getEnv } from './env';
import { createLogger } from './logger';
import type { PendingTransaction } from '@/types/transaction';

const log = createLogger('pending');

const KEY_PREFIX = 'kumibooks:pending:';
const DEFAULT_TTL_SEC = 5 * 60;

interface Store {
  set(token: string, data: PendingTransaction, ttlSec: number): Promise<void>;
  get(token: string): Promise<PendingTransaction | null>;
  delete(token: string): Promise<void>;
}

let cachedStore: Store | null = null;

function getStore(): Store {
  if (cachedStore) return cachedStore;
  const env = getEnv();
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    cachedStore = new UpstashStore(
      env.UPSTASH_REDIS_REST_URL,
      env.UPSTASH_REDIS_REST_TOKEN
    );
    log.info('using Upstash Redis store');
  } else {
    cachedStore = new MemoryStore();
    log.warn(
      'using in-memory pending store — Vercel serverless instances do NOT share state. Configure UPSTASH_REDIS_* for production.'
    );
  }
  return cachedStore;
}

export async function savePending(
  data: PendingTransaction,
  ttlSec = DEFAULT_TTL_SEC
): Promise<void> {
  await getStore().set(data.token, data, ttlSec);
}

export async function getPending(
  token: string
): Promise<PendingTransaction | null> {
  return getStore().get(token);
}

export async function deletePending(token: string): Promise<void> {
  await getStore().delete(token);
}

// ─── Upstash Redis REST ────────────────────────────────────────────────

class UpstashStore implements Store {
  constructor(
    private url: string,
    private token: string
  ) {}

  private async exec(command: unknown[]): Promise<unknown> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(command)
    });
    if (!res.ok) {
      throw new Error(
        `Upstash ${res.status}: ${await res.text().catch(() => '')}`
      );
    }
    const json = (await res.json()) as { result?: unknown; error?: string };
    if (json.error) throw new Error(`Upstash: ${json.error}`);
    return json.result;
  }

  async set(
    token: string,
    data: PendingTransaction,
    ttlSec: number
  ): Promise<void> {
    await this.exec([
      'SET',
      KEY_PREFIX + token,
      JSON.stringify(data),
      'EX',
      String(ttlSec)
    ]);
  }

  async get(token: string): Promise<PendingTransaction | null> {
    const raw = (await this.exec(['GET', KEY_PREFIX + token])) as
      | string
      | null;
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PendingTransaction;
    } catch (err) {
      log.error('failed to parse pending JSON', {
        token,
        err: err instanceof Error ? err.message : String(err)
      });
      return null;
    }
  }

  async delete(token: string): Promise<void> {
    await this.exec(['DEL', KEY_PREFIX + token]);
  }
}

// ─── In-memory (dev / single-instance fallback) ───────────────────────

interface MemoryEntry {
  data: PendingTransaction;
  expiresAt: number;
}

class MemoryStore implements Store {
  private map = new Map<string, MemoryEntry>();

  private sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.map) {
      if (v.expiresAt <= now) this.map.delete(k);
    }
  }

  async set(
    token: string,
    data: PendingTransaction,
    ttlSec: number
  ): Promise<void> {
    this.sweep();
    this.map.set(token, {
      data,
      expiresAt: Date.now() + ttlSec * 1000
    });
  }

  async get(token: string): Promise<PendingTransaction | null> {
    this.sweep();
    const entry = this.map.get(token);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(token);
      return null;
    }
    return entry.data;
  }

  async delete(token: string): Promise<void> {
    this.map.delete(token);
  }
}
