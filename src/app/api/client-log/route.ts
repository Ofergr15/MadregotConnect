import { NextResponse } from 'next/server';

// Zero-auth fire-and-forget sink for client-side breadcrumbs from real devices
// (iOS PWA fetch/lifecycle bugs don't reproduce in any emulator we have —
// this is how we see what actually happened without asking the user to
// screenshot their screen). Grep for these via `vercel logs --search client-log`.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    console.log('[client-log]', JSON.stringify(body));
  } catch {
    // malformed body — nothing to log, don't fail the beacon
  }
  return NextResponse.json({ ok: true });
}
