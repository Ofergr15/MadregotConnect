import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireAthlete, authError } from '@/lib/auth-session';
import { israelToday } from '@/lib/utils';
import { waShareUrl, waPhone } from '@/lib/academy/manage';
import { meetupWaText } from '@/lib/runs/meetups';
import { rosterFull, factsFor, visibleTo, areaOf, type MeetupRow, type RequestRow } from '@/lib/runs/meetups-server';
import { canSeeExact } from '@/lib/runs/together';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

// GET /api/runs/meetups/:id/wa?to=<athleteId> → { url } — a WhatsApp chat straight to one
// of the run's people (the host or someone going). The app's requests carry a bearer token,
// so this answers JSON for the page to open, not a redirect a plain link would follow without
// it. The number exists only in that wa.me URL, never in the meetup payload.
export async function GET(request: Request, { params }: Params) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);
  const { id } = await params;
  const to = new URL(request.url).searchParams.get('to') || '';
  if (!to || to === auth.user.athleteId) return NextResponse.json({ error: 'to required' }, { status: 400 });
  const db = createServerClient();
  const [{ data: row }, { data: reqs }, inv] = await Promise.all([
    db.from('run_meetups').select('*').eq('id', id).maybeSingle(),
    db.from('run_meetup_requests').select('meetup_id, athlete_id, status').eq('meetup_id', id),
    db.from('run_meetup_invites').select('meetup_id, athlete_id').eq('meetup_id', id),
  ]);
  if (!row) return NextResponse.json({ error: 'No such run' }, { status: 404 });
  const m = row as MeetupRow;
  const me = auth.user.athleteId;
  const f = factsFor(m, (reqs || []) as RequestRow[], inv.error ? [] : (inv.data || []) as Array<{ meetup_id: string; athlete_id: string }>, me);
  const going = [m.host_athlete_id, ...f.joinedIds];
  // Only for someone who may see this run, and only to the run's own people: this is not a
  // way to look up any member's number.
  const ros = await rosterFull(db);
  if (!visibleTo(m, f, { id: me, groupId: ros.groupOf.get(me) ?? null }, ros.groupOf.get(m.host_athlete_id))) {
    return NextResponse.json({ error: 'No such run' }, { status: 404 });
  }
  // The prefilled text names the place: the exact one only for host + joiners (migration 190).
  const place = canSeeExact({ hostId: m.host_athlete_id, joinedIds: f.joinedIds }, me) ? m.location : (areaOf(m).label || 'אזור המפגש');
  if (!going.includes(to)) return NextResponse.json({ error: 'Not in this run' }, { status: 403 });
  const { data: person } = await db.from('athletes').select('name, phone').eq('id', to).maybeSingle();
  const p = person as { name: string | null; phone: string | null } | null;
  if (!p || !waPhone(p.phone)) return NextResponse.json({ error: 'No WhatsApp' }, { status: 404 });
  return NextResponse.json({ url: waShareUrl(p.phone, meetupWaText(p.name, { ...m, location: place }, israelToday())) });
}
