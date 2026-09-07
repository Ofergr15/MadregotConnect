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

/** One reminder. Shared so bulk and single can never drift into two behaviours. */
async function nudgeOne(
  supabase: ReturnType<typeof createServerClient>,
  caller: { athleteId?: string | null },
  athleteId: string,
): Promise<{ found: boolean; reachable: boolean; missing: 'setup' | 'watch' }> {
  const { data: athlete } = await supabase
    .from('athletes')
    .select('id, name, garmin_auth, strava_auth')
    .eq('id', athleteId)
    .maybeSingle();
  if (!athlete) return { found: false, reachable: false, missing: 'watch' };

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
    actorAthleteId: caller.athleteId || undefined,
    copy: (locale) => entryNudgeCopy(locale, { name: athlete.name, missing }),
    // Straight to the checklist, not /dashboard: the tap should land on the thing
    // the notification is about.
    url: '/dashboard/profile',
    tag: 'entry-nudge',
    // No category. Muting "come and finish signing up" is not a setting anybody
    // asked for, and this is at most a handful of sends a month.
  });

  return { found: true, reachable, missing };
}

// A bulk call is the same reminder N times, so it is capped: the club is 28 people
// and anything past this is a mistake, not a bigger club.
const MAX_BULK = 60;

export async function POST(request: Request) {
  try {
    const { denied, caller } = await requireStaffCaller(request);
    if (denied) return denied;
    if (!caller.canApprove) {
      return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
    }

    const { athleteId, athleteIds } = (await request.json().catch(() => ({}))) as {
      athleteId?: string;
      athleteIds?: string[];
    };

    // ── bulk: "remind everybody who hasn't finished" ──────────────────────────
    // One request per person still, just not one round trip per person from a phone
    // on the touchline. Sequential on purpose — these are push sends to a shared
    // provider, and 23 at once buys nothing but rate limits.
    if (Array.isArray(athleteIds)) {
      const ids = [...new Set(athleteIds.filter(Boolean))].slice(0, MAX_BULK);
      if (!ids.length) return NextResponse.json({ error: 'athleteIds is empty' }, { status: 400 });

      const supabase = createServerClient();
      const results: Record<string, 'sent' | 'unreachable' | 'failed'> = {};
      for (const id of ids) {
        try {
          const one = await nudgeOne(supabase, caller, id);
          results[id] = one.found ? (one.reachable ? 'sent' : 'unreachable') : 'failed';
        } catch (err) {
          console.error('Bulk nudge failed for', id, err);
          results[id] = 'failed';
        }
      }
      const tally = (value: string) => Object.values(results).filter((r) => r === value).length;
      return NextResponse.json({
        ok: true,
        results,
        sent: tally('sent'),
        unreachable: tally('unreachable'),
        failed: tally('failed'),
      });
    }

    if (!athleteId) return NextResponse.json({ error: 'athleteId is required' }, { status: 400 });

    const one = await nudgeOne(createServerClient(), caller, athleteId);
    if (!one.found) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    return NextResponse.json({ ok: true, reachable: one.reachable, missing: one.missing });
  } catch (err) {
    console.error('Failed to nudge:', err);
    return NextResponse.json({ error: 'Failed to send the reminder' }, { status: 500 });
  }
}
