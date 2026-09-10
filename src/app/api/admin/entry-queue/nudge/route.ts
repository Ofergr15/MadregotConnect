import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { notifyAthlete } from '@/lib/push';
import { entryGapsCopy } from '@/lib/notifications/copy';
import { computeSetupState } from '@/lib/onboarding/setup-tasks';
import { KIT_SIZE_COLUMNS_099, kitSizeSetupInput } from '@/lib/kit-sizes';

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

const SETUP_COLUMNS =
  'garmin_auth, strava_auth, data_source, avatar_url, phone, birth_date, gender, shirt_size, shoe_size, group_id, active_shoe_id';

/** One reminder. Shared so bulk and single can never drift into two behaviours. */
async function nudgeOne(
  supabase: ReturnType<typeof createServerClient>,
  caller: { athleteId?: string | null },
  athleteId: string,
): Promise<{ found: boolean; reachable: boolean; gaps: string[] }> {
  // 099's kit sizes are asked for separately, because this is the one read here
  // with no not-yet-migrated fallback of its own: a missing column would fail the
  // whole nudge, and a nudge is the thing that TELLS a member to fill these in.
  let { data: athlete } = await supabase
    .from('athletes')
    .select(`id, name, last_seen_at, ${SETUP_COLUMNS}, ${KIT_SIZE_COLUMNS_099}`)
    .eq('id', athleteId)
    .maybeSingle();
  if (!athlete) {
    ({ data: athlete } = await supabase
      .from('athletes')
      .select(`id, name, last_seen_at, ${SETUP_COLUMNS}`)
      .eq('id', athleteId)
      .maybeSingle());
  }
  if (!athlete) return { found: false, reachable: false, gaps: [] };

  // Do they have a subscription to push to at all? Without one this is an
  // inbox-only row, and saying so is the point — otherwise the admin taps a
  // button, sees a tick and believes somebody's phone lit up.
  const { count } = await supabase
    .from('push_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('athlete_id', athleteId);
  const reachable = (count ?? 0) > 0;

  // Recomputed here rather than taken from the request: the message names things
  // about a member, so what it names has to come from the row, not from whatever
  // a client posted. Same rule as memberGaps — never landed inside the app is the
  // only gap worth mentioning to somebody who cannot get in.
  const setup = computeSetupState({
    hasGarminAuth: !!athlete.garmin_auth,
    hasStravaAuth: !!athlete.strava_auth,
    dataSource: (athlete.data_source as string) || null,
    avatarUrl: (athlete.avatar_url as string) || null,
    phone: (athlete.phone as string) || null,
    birthDate: (athlete.birth_date as string) || null,
    gender: (athlete.gender as string) || null,
    shirtSize: (athlete.shirt_size as string) || null,
    ...kitSizeSetupInput(athlete as unknown as Record<string, unknown>),
    shoeSize: (athlete.shoe_size as string) || null,
    pushSubscriptions: reachable ? 1 : 0,
    groupName: athlete.group_id ? 'set' : null,
    hasActiveShoe: !!athlete.active_shoe_id,
  });
  const gaps = athlete.last_seen_at
    ? setup.tasks
        .filter((t) => !t.done)
        // 'notifications' is unlistable BY a notification: the only way this send
        // arrives is a subscription existing, which is the task itself. Naming it
        // would tell somebody to turn on the thing they are currently reading.
        .filter((t) => t.key !== 'notifications')
        .map((t) => t.key as string)
    : ['login'];

  await notifyAthlete({
    athleteId,
    kind: 'entry_nudge',
    actorAthleteId: caller.athleteId || undefined,
    copy: (locale) => entryGapsCopy(locale, { name: athlete.name as string, gaps }),
    // Straight to the checklist, not /dashboard: the tap should land on the thing
    // the notification is about.
    url: '/dashboard/profile',
    tag: 'entry-nudge',
    // No category. Muting "come and finish signing up" is not a setting anybody
    // asked for, and this is at most a handful of sends a month.
  });

  return { found: true, reachable, gaps };
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

    return NextResponse.json({ ok: true, reachable: one.reachable, gaps: one.gaps });
  } catch (err) {
    console.error('Failed to nudge:', err);
    return NextResponse.json({ error: 'Failed to send the reminder' }, { status: 500 });
  }
}
