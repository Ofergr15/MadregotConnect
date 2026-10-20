import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireAthlete, authError } from '@/lib/auth-session';
import { israelToday } from '@/lib/utils';
import { waShareUrl, waPhone } from '@/lib/academy/manage';
import { meetupWaText, meetupVisibleTo } from '@/lib/runs/meetups';
import { roster } from '@/lib/runs/meetups-server';

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
  const [{ data: row }, { data: reqs }] = await Promise.all([
    db.from('run_meetups').select('id, host_athlete_id, date, start_time, location, kind, audience').eq('id', id).maybeSingle(),
    db.from('run_meetup_requests').select('athlete_id, status').eq('meetup_id', id),
  ]);
  if (!row) return NextResponse.json({ error: 'No such run' }, { status: 404 });
  const m = row as { id: string; host_athlete_id: string; date: string; start_time: string; location: string; kind: string | null; audience?: string | null };
  const going = [m.host_athlete_id, ...((reqs || []) as Array<{ athlete_id: string; status: string }>).filter((r) => r.status === 'accepted').map((r) => r.athlete_id)];
  // Only for someone who may see this run, and only to the run's own people: this is not a
  // way to look up any member's number.
  const people = await roster(db);
  const me = auth.user.athleteId;
  if (!meetupVisibleTo({ hostId: m.host_athlete_id, audience: m.audience === 'pack' ? 'pack' : 'club', hostPack: people.get(m.host_athlete_id)?.pack ?? null, goingIds: going }, { id: me, pack: people.get(me)?.pack ?? null })) {
    return NextResponse.json({ error: 'No such run' }, { status: 404 });
  }
  if (!going.includes(to)) return NextResponse.json({ error: 'Not in this run' }, { status: 403 });
  const { data: person } = await db.from('athletes').select('name, phone').eq('id', to).maybeSingle();
  const p = person as { name: string | null; phone: string | null } | null;
  if (!p || !waPhone(p.phone)) return NextResponse.json({ error: 'No WhatsApp' }, { status: 404 });
  return NextResponse.json({ url: waShareUrl(p.phone, meetupWaText(p.name, m, israelToday())) });
}
