import { NextResponse } from 'next/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { allowClientLog, clientIp, CLIENT_LOG_MAX_BYTES, readCappedJson, redactSecrets } from '@/lib/public-sinks';

// Zero-auth fire-and-forget sink for client-side breadcrumbs from real devices
// (iOS PWA fetch/lifecycle bugs don't reproduce in any emulator we have —
// this is how we see what actually happened without asking the user to
// screenshot their screen). Grep for these via `vercel logs --search client-log`.
//
// Task 78: per-IP rate limit, 4 KB cap, credential-looking keys redacted, and the
// caller is named only from a verified bearer — a body field can never claim to be someone.
export async function POST(request: Request) {
  if (!allowClientLog(clientIp(request.headers))) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const read = await readCappedJson(request, CLIENT_LOG_MAX_BYTES);
  if (!read.ok) {
    // malformed body — nothing to log, don't fail the beacon; an oversized one is refused
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'too_large' }, { status: 413 })
      : NextResponse.json({ ok: true });
  }
  let caller: string | null = null;
  if (request.headers.get('authorization')) {
    try {
      const { denied, caller: c } = await resolveVerifiedCaller(request);
      if (!denied) caller = c.athleteId;
    } catch {
      // an unverifiable bearer just logs anonymously
    }
  }
  console.log('[client-log]', JSON.stringify({ caller, body: redactSecrets(read.body) }));
  return NextResponse.json({ ok: true });
}
