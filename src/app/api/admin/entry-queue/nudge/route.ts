import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { notifyAthlete } from '@/lib/push';
import { entryNudgeCopy } from '@/lib/notifications/copy';

export const dynamic = 'force-dynamic';

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/admin/entry-queue/nudge  { athleteId }
//
// The one action the entry queue was missing: a reminder for somebody who was
// approved and never came in. Nothing is holding them out — they just never
// arrived, or arrived and stopped short of connecting a watch — and there was no
// way at all to reach them from the app. That is the quietest way to lose a member.
//
// Push only, deliberately: half the club signed in through Strava and has no real
// address (see the synthetic-address skip in lib/email/send.ts), so mail would
// reach the wrong half of exactly this group.
//
// Approver-gated rather than merely staff-gated. It is an unsolicited notification
// to a named person, and the same people who may let somebody in are the people who
// may prod them.
// ═════════════════════════════════════════════════════════════════════════════

export async function POST(request: Request) {
  try {
    const { denied, caller } = await requireStaffCaller(request);
    if (denied) return denied;
    if (!caller.canApprove) {
      return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
    }

    const { athleteId } = await request.json().catch(() => ({}));
    if (!athleteId) return NextResponse.json({ error: 'athleteId is required' }, { status: 400 });

    const supabase = createServerClient();
    const { data: athlete } = await supabase
      .from('athletes')
      .select('id, name, garmin_auth, strava_auth')
      .eq('id', athleteId)
      .maybeSingle();
    if (!athlete) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // Do they have a subscription to push to at all? Without one this is an
    // inbox-only row, and saying so is the point — otherwise the admin taps a
    // button, sees a tick and believes somebody's phone lit up.
    const { count } = await supabase
      .from('push_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('athlete_id', athleteId);
    const reachable = (count ?? 0) > 0;

    const missing = athlete.garmin_auth || athlete.strava_auth ? 'setup' : 'watch';

    await notifyAthlete({
      athleteId,
      kind: 'entry_nudge',
      actorAthleteId: caller.athleteId,
      copy: (locale) => entryNudgeCopy(locale, { name: athlete.name, missing }),
      // Straight to the checklist, not /dashboard: the tap should land on the thing
      // the notification is about.
      url: '/dashboard/profile',
      tag: 'entry-nudge',
      // No category. Muting "come and finish signing up" is not a setting anybody
      // asked for, and this is at most a handful of sends a month.
    });

    return NextResponse.json({ ok: true, reachable, missing });
  } catch (err) {
    console.error('Failed to nudge:', err);
    return NextResponse.json({ error: 'Failed to send the reminder' }, { status: 500 });
  }
}
