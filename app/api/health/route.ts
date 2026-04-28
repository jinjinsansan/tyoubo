import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'kumibooks',
    version: '0.1.0',
    sprint: 1,
    time: new Date().toISOString()
  });
}
