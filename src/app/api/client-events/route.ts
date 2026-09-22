import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { sanitiseEvents } from '@/lib/bugs/client-events';

export const dynamic = 'force-dynamic';

/**
 * The one door the browser has into `client_events` — see migration 118 for what
 * the table is for and `lib/bugs/client-events.ts` for the rules of the wire.
 *
 * ── WHY THIS DOES NOT WIDEN ANYTHING ────────────────────────────────────────
 *
 * It is a write-only funnel into one debugging table. There is no GET: the only
 * reader is the nightly detector pass, which runs as a cron with the service
 * role, so nothing here gives a caller a way to read anything — not their own
 * events, and certainly not anybody else's.
 *
 * The session is required, and the athlete is taken from it. That means a crash
 * on the LOGIN page is not reported, which is a real gap and the right trade: the
 * alternative is an endpoint that accepts writes from anybody on the internet, on
 * a public URL, for a 25-person club. The five detectors this feeds are all about
 * signed-in use of the app anyway.
 *
 * It always answers 200 with a count, including when it stored nothing. The
 * reporter must never retry, never queue, and never surface a failure to an
 * athlete — a bug reporter that produces its own visible errors is worse than no
 * bug reporter, and one that retries turns a bad deploy into a flood.
 */
export async function POST(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;

    const events = sanitiseEvents(await request.json().catch(() => null));
    if (!events.length) return NextResponse.json({ stored: 0 });

    const supabase = createServerClient();
    const { error } = await supabase
      .from('client_events')
      .insert(events.map(e => ({ ...e, athlete_id: caller.athleteId })));

    // A missing table (migration 118 unapplied) is reported as stored: 0 rather
    // than as a 500. The client cannot do anything about it either way, and a 500
    // here would show up in the app's own error reporting as a bug of its own.
    if (error) return NextResponse.json({ stored: 0, storageMissing: true });

    return NextResponse.json({ stored: events.length });
  } catch {
    return NextResponse.json({ stored: 0 });
  }
}
