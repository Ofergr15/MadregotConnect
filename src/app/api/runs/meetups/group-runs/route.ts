import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireMember } from '@/lib/auth/self-or-staff';
import { requireAthlete } from '@/lib/auth-session';
import { israelToday } from '@/lib/utils';
import { addDaysIso } from '@/lib/runs/meetups';
import { readHiddenFields } from '@/lib/feed/project';
import { rosterFull, factsFor, visibleTo, areaOf, type MeetupRow, type RequestRow } from '@/lib/runs/meetups-server';
import { groupRunCard } from '@/lib/runs/together';

export const dynamic = 'force-dynamic';

// GET /api/runs/meetups/group-runs?days=7 → { groupRuns: GroupRunCard[] }
// One feed item per finished run that 2+ joiners actually ran together
// (run_meetup_activities, linked by cron/tick). Seen by whoever may see the run itself.
// Each row: name, km, pace — pace null when that activity's feed item hides pace
// (the same `pace` hidden-field key the feed honours). Plan accuracy is NEVER in here:
// it is self-or-staff, and this card is group-visible.
// Place: the AREA label only — the feed is wider than the people who were there.
export async function GET(request: Request) {
  const denied = await requireMember(request);
  if (denied) return denied;
  try {
    const auth = await requireAthlete(request);
    const viewerId = auth.ok ? auth.user.athleteId : null;
    const days = Math.min(30, Math.max(1, Number(new URL(request.url).searchParams.get('days')) || 7));
    const db = createServerClient();
    const today = israelToday();
    const { data: links, error } = await db.from('run_meetup_activities').select('meetup_id, activity_id, athlete_id')
      .gte('created_at', `${addDaysIso(today, -days - 2)}T00:00:00`);
    if (error) return NextResponse.json({ groupRuns: [] }); // pre-190
    const rows = (links || []) as Array<{ meetup_id: string; activity_id: string; athlete_id: string }>;
    const meetupIds = [...new Set(rows.map((r) => r.meetup_id))];
    if (!meetupIds.length) return NextResponse.json({ groupRuns: [] });
    const actIds = rows.map((r) => r.activity_id);
    const [{ data: meetups }, { data: reqs }, inv, { data: acts }, { data: items }, ros] = await Promise.all([
      db.from('run_meetups').select('*').in('id', meetupIds).gte('date', addDaysIso(today, -days)),
      db.from('run_meetup_requests').select('meetup_id, athlete_id, status').in('meetup_id', meetupIds),
      db.from('run_meetup_invites').select('meetup_id, athlete_id').in('meetup_id', meetupIds),
      db.from('athlete_activities').select('id, athlete_id, distance, duration').in('id', actIds),
      db.from('feed_items').select('activity_id, payload').in('activity_id', actIds),
      rosterFull(db),
    ]);
    const viewer = viewerId ? { id: viewerId, groupId: ros.groupOf.get(viewerId) ?? null } : null;
    const hidePace = new Set(((items || []) as Array<{ activity_id: string; payload: Record<string, unknown> | null }>)
      .filter((i) => readHiddenFields(i.payload).has('pace')).map((i) => i.activity_id));
    const actById = new Map(((acts || []) as Array<{ id: string; athlete_id: string; distance: number; duration: number }>).map((a) => [a.id, a]));
    const out = ((meetups || []) as MeetupRow[]).flatMap((m) => {
      const f = factsFor(m, (reqs || []) as RequestRow[], inv.error ? [] : (inv.data || []) as Array<{ meetup_id: string; athlete_id: string }>, viewerId);
      if (!visibleTo(m, f, viewer, ros.groupOf.get(m.host_athlete_id))) return [];
      const card = groupRunCard({
        meetup: { id: m.id, date: m.date, startTime: m.start_time, areaLabel: areaOf(m).label, planLinked: m.plan_id != null },
        runs: rows.filter((r) => r.meetup_id === m.id).flatMap((r) => {
          const a = actById.get(r.activity_id);
          return a ? [{ activityId: a.id, athleteId: a.athlete_id, distanceM: a.distance, durationS: a.duration, paceHidden: hidePace.has(a.id) }] : [];
        }),
        people: ros.people, viewerId,
      });
      return card ? [card] : [];
    }).sort((a, b) => (b.date + b.startTime).localeCompare(a.date + a.startTime));
    return NextResponse.json({ groupRuns: out });
  } catch (err: unknown) {
    console.error('Group runs fetch error:', err);
    return NextResponse.json({ error: 'Failed to load group runs' }, { status: 500 });
  }
}
