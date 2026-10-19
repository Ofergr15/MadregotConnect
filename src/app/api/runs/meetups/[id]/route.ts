import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireMember } from '@/lib/auth/self-or-staff';
import { requireAthlete, authError } from '@/lib/auth-session';
import { israelToday } from '@/lib/utils';
import { notifyAthlete } from '@/lib/push';
import { meetupMessageCopy } from '@/lib/notifications/copy';
import { roster, toMeetup } from '@/lib/runs/meetups-server';

export const dynamic = 'force-dynamic';

const MAX_MESSAGE = 400;

type Params = { params: Promise<{ id: string }> };

async function load(id: string, viewerId: string | null) {
  const db = createServerClient();
  const [{ data: row }, people, { data: reqs }, { data: msgs }] = await Promise.all([
    db.from('run_meetups').select('*').eq('id', id).maybeSingle(),
    roster(db),
    db.from('run_meetup_requests').select('athlete_id, status').eq('meetup_id', id),
    db.from('run_meetup_messages').select('id, athlete_id, body, created_at').eq('meetup_id', id).order('created_at'),
  ]);
  if (!row) return null;
  const joined = ((reqs || []) as Array<{ athlete_id: string; status: string }>).filter((r) => r.status === 'accepted').map((r) => r.athlete_id);
  const messages = ((msgs || []) as Array<{ id: string; athlete_id: string; body: string; created_at: string }>).map((m) => ({
    id: m.id, body: m.body, createdAt: m.created_at, from: people.get(m.athlete_id) ?? { id: m.athlete_id, name: '', avatarUrl: null, pack: null }, mine: m.athlete_id === viewerId,
  }));
  return {
    db, row: row as { host_athlete_id: string; status: string; date: string } & Record<string, unknown>,
    joined, people,
    meetup: { ...toMeetup(row as never, joined, people, viewerId, messages.length), status: (row as { status: string }).status, over: (row as { date: string }).date < israelToday() },
    messages,
  };
}

// GET /api/runs/meetups/:id → { meetup, messages }
export async function GET(request: Request, { params }: Params) {
  const denied = await requireMember(request);
  if (denied) return denied;
  const { id } = await params;
  const auth = await requireAthlete(request);
  const got = await load(id, auth.ok ? auth.user.athleteId : null);
  if (!got) return NextResponse.json({ error: 'No such run' }, { status: 404 });
  return NextResponse.json({ meetup: got.meetup, messages: got.messages });
}

// POST /api/runs/meetups/:id { body } — a message to the people going. Only the host and
// those who joined may write; everyone else may read.
export async function POST(request: Request, { params }: Params) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);
  const { id } = await params;
  const { body } = (await request.json().catch(() => ({}))) as { body?: unknown };
  const text = typeof body === 'string' ? body.trim().slice(0, MAX_MESSAGE) : '';
  if (!text) return NextResponse.json({ error: 'body required' }, { status: 400 });
  const got = await load(id, auth.user.athleteId);
  if (!got) return NextResponse.json({ error: 'No such run' }, { status: 404 });
  const going = [got.row.host_athlete_id, ...got.joined];
  if (!going.includes(auth.user.athleteId)) return NextResponse.json({ error: 'Join the run to write' }, { status: 403 });
  const { error } = await got.db.from('run_meetup_messages').insert({ meetup_id: id, athlete_id: auth.user.athleteId, body: text });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const me = got.people.get(auth.user.athleteId);
  await Promise.all([...new Set(going)].filter((a) => a !== auth.user.athleteId).map((athleteId) => notifyAthlete({
    athleteId,
    kind: 'meetup_message',
    actorAthleteId: auth.user.athleteId,
    url: `/dashboard/run-together/${id}`,
    tag: `meetup-msg-${id}`,
    category: 'teammates',
    icon: me?.avatarUrl || undefined,
    copy: (locale) => meetupMessageCopy(locale, { name: me?.name, body: text }),
  }).catch(() => {})));
  return NextResponse.json({ ok: true });
}
