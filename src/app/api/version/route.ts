import { NextResponse } from 'next/server';
import { APP_VERSION } from '@/lib/version';

export const dynamic = 'force-dynamic';

/**
 * GET /api/version — the version this deployment runs. The app asks on open and on
 * coming back (components/UpdatePrompt): a newer one here means the phone is on an
 * old build, and it updates before anything else is done (Ofer 10-20: "an update is
 * out and the app keeps working in the background — it clashes"). Public, tiny, never cached.
 */
export function GET() {
  return NextResponse.json({ version: APP_VERSION }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}
