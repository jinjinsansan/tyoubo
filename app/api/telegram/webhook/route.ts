import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/utils/env';
import { handleUpdate } from '@/lib/telegram/handlers';
import { createLogger } from '@/lib/utils/logger';
import type { TelegramUpdate } from '@/lib/telegram/bot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('webhook');

/**
 * Verifies the incoming request:
 *   1. ?secret= query parameter matches TELEGRAM_WEBHOOK_SECRET
 *   2. X-Telegram-Bot-Api-Secret-Token header matches TELEGRAM_WEBHOOK_SECRET
 *
 * Both are required; either alone would let an attacker forge the other.
 */
function authenticate(req: Request): boolean {
  const env = getEnv();
  const url = new URL(req.url);
  const secretQuery = url.searchParams.get('secret');
  const secretHeader = req.headers.get('x-telegram-bot-api-secret-token');
  return (
    secretQuery === env.TELEGRAM_WEBHOOK_SECRET &&
    secretHeader === env.TELEGRAM_WEBHOOK_SECRET
  );
}

export async function POST(req: Request) {
  if (!authenticate(req)) {
    log.warn('unauthorized webhook call');
    return new NextResponse('Unauthorized', { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch (err) {
    log.error('invalid json body', {
      err: err instanceof Error ? err.message : String(err)
    });
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  try {
    await handleUpdate(update);
  } catch (err) {
    log.error('handler error', {
      update_id: update.update_id,
      err: err instanceof Error ? err.message : String(err)
    });
    // Always return 200 so Telegram doesn't retry endlessly on app bugs.
  }

  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true, method: 'webhook ready' });
}
