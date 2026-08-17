/**
 * POST /api/dev/auth-log
 *
 * Mirrors browser-side auth diagnostics into the Next.js terminal. Values are
 * sanitized by the caller; never send access tokens, refresh tokens, or hashes.
 */
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const debugId = typeof body.debugId === 'string' ? body.debugId : 'unknown';
  const event = typeof body.event === 'string' ? body.event : 'unknown';
  const details =
    body.details && typeof body.details === 'object' && !Array.isArray(body.details)
      ? body.details
      : {};

  console.info(`[auth-debug:${debugId}] browser:${event}`, details);
  return NextResponse.json({ ok: true });
}
