import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';

export const dynamic = 'force-dynamic';

/**
 * POST /api/notifications/seen — "I've looked at my notifications" (plan V6, native inbox).
 *
 * "Read" is one timestamp, `athletes.last_seen_at`: the unread count is everything sent since it.
 * The web stamps it from GET /api/auth/me on every page load; the native app needs to stamp it
 * when the inbox is opened, without that bootstrap call. Identity comes from the verified session
 * only (no body, no query) — a caller can only ever mark their OWN notifications seen.
 *
 * 200 { seenAt } · 401 no/invalid session · 403 no athlete row (e.g. legacy coach-only account) ·
 * 204 while viewing as someone else (their last-seen is not ours to move, same rule as auth/me).
 */
export async function POST(request: Request) {
  try {
    const auth = await requireSession(request);
    if (!auth.ok) return authError(auth);
    if (auth.user.viewingAsBy) return new NextResponse(null, { status: 204 });
    const athleteId = auth.user.athleteId;
    if (!athleteId) return NextResponse.json({ error: 'No athlete profile' }, { status: 403 });

    const seenAt = new Date().toISOString();
    const { error } = await createServerClient().from('athletes').update({ last_seen_at: seenAt }).eq('id', athleteId);
    if (error) {
      console.error('notifications/seen update failed:', error);
      return NextResponse.json({ error: 'Failed to mark seen' }, { status: 500 });
    }
    return NextResponse.json({ seenAt });
  } catch (error) {
    console.error('notifications/seen failed:', error);
    return NextResponse.json({ error: 'Failed to mark seen' }, { status: 500 });
  }
}
