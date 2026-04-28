import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/utils/env';
import { generateMonthlyReport } from '@/lib/reports/monthly';
import { createLogger } from '@/lib/utils/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Vercel free-tier serverless functions cap at 10s. Reading the whole
// transactions sheet + Telegram + sheet append usually completes in <5s
// but give it headroom.
export const maxDuration = 60;

const log = createLogger('cron-monthly');

function authenticate(req: Request): boolean {
  const env = getEnv();
  const auth = req.headers.get('authorization') ?? '';
  return auth === `Bearer ${env.CRON_SECRET}`;
}

const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Vercel Cron handler. Also callable manually for testing:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://<host>/api/cron/monthly-report?ym=2026-03&force=1"
 */
export async function GET(req: Request) {
  if (!authenticate(req)) {
    log.warn('unauthorized');
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const url = new URL(req.url);
  const ymParam = url.searchParams.get('ym');
  const force = url.searchParams.get('force') === '1';

  if (ymParam && !YEAR_MONTH.test(ymParam)) {
    return NextResponse.json(
      { ok: false, error: 'ym must be YYYY-MM' },
      { status: 400 }
    );
  }

  try {
    const result = await generateMonthlyReport({
      yearMonth: ymParam ?? undefined,
      force
    });
    return NextResponse.json({
      ok: true,
      yearMonth: result.yearMonth,
      alreadyReported: result.alreadyReported,
      eomBalanceJpy: result.eomBalanceJpy,
      summary: result.summary,
      telegramMessageId: result.telegramMessageId
    });
  } catch (err) {
    log.error('failed', {
      err: err instanceof Error ? err.message : String(err)
    });
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      },
      { status: 500 }
    );
  }
}
