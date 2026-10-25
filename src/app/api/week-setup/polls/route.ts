import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller, type VerifiedCaller } from '@/lib/auth/self-or-staff';
import { israelToday } from '@/lib/utils';
import { canEdit } from '@/lib/week-setup/model';
import { loadOwners, whoOf } from '@/lib/week-setup/server';
import { removePoll, upsertPoll, validPoll, type PlannedPoll } from '@/lib/week-setup/planned-polls';
import { loadPlannedPolls, publishPoll, savePlannedPolls } from '@/lib/week-setup/planned-polls-server';

export const dynamic = 'force-dynamic';

const SUNDAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

/** The polls' owner who may also publish (a poll goes out to members as the club). */
async function gate(request: Request) {
  const { denied, caller } = await requireStaffCaller(request);
  if (denied) return { denied } as const;
  const roles = caller.roles ?? [caller.role];
  const owners = await loadOwners(createServerClient());
  if (!canEdit('polls', owners, { admin: caller.isSuperUser || roles.includes('admin'), coach: caller.isStaff }) || !(caller.isSuperUser || caller.canApprove)) {
    return { denied: NextResponse.json({ error: 'Not yours to publish' }, { status: 403 }) } as const;
  }
  return { caller } as const;
}

// POST /api/week-setup/polls { week, poll, now? } — a poll written on the Saturday screen: kept to
// go out at poll.sendAt (the tick sends it, lib/week-setup/planned-polls), or out now with `now`.
// An existing id changes a poll that hasn't gone yet.
export async function POST(request: Request) {
  const g = await gate(request);
  if ('denied' in g) return g.denied;
  const body = await request.json().catch(() => null);
  const week = typeof body?.week === 'string' && SUNDAY.test(body.week) ? body.week : null;
  const x = (body?.poll ?? {}) as Partial<PlannedPoll>;
  if (!week) return NextResponse.json({ error: 'week is required' }, { status: 400 });
  const now = new Date().toISOString();
  const sendAt = body?.now ? now : x.sendAt;
  const bad = validPoll({ ...x, sendAt }, now);
  if (bad) return NextResponse.json({ error: `bad ${bad}` }, { status: 400 });
  if (!body?.now && Date.parse(sendAt!) < Date.now() - 60_000) return NextResponse.json({ error: 'sendAt is in the past' }, { status: 400 });
  const supabase = createServerClient();
  const store = await loadPlannedPolls(supabase);
  const existing = typeof x.id === 'string' && UUID.test(x.id) ? (store[week] || []).find((p) => p.id === x.id) : undefined;
  if (existing?.publishedAt) return NextResponse.json({ error: 'already sent' }, { status: 409 });
  const who = await whoOf(supabase, g.caller.athleteId);
  const poll: PlannedPoll = {
    id: existing?.id ?? randomUUID(),
    question: x.question!.trim().slice(0, 300),
    options: (x.options || []).map((o) => String(o).trim().slice(0, 80)).filter(Boolean).slice(0, 8),
    closesAt: x.closesAt && Number.isFinite(Date.parse(x.closesAt)) ? new Date(x.closesAt).toISOString() : null,
    multi: x.multi === true,
    anonymous: x.anonymous === true,
    audienceType: x.audienceType === 'group' && typeof x.audienceId === 'string' && UUID.test(x.audienceId) ? 'group' : 'all',
    audienceId: x.audienceType === 'group' && typeof x.audienceId === 'string' && UUID.test(x.audienceId) ? x.audienceId : null,
    sendAt: new Date(sendAt!).toISOString(),
    ...(typeof x.rides === 'string' && /^dayBefore:\d$/.test(x.rides) ? { rides: x.rides } : {}),
    feed: x.feed !== false,
    by: who.name,
    byId: g.caller.athleteId,
    email: emailOf(g.caller),
    createdAt: existing?.createdAt ?? now,
  };
  try {
    if (body?.now) {
      // Out now — and kept on the week's list, as sent, so the screen shows it went.
      const surveyId = await publishPoll(supabase, week, poll);
      await savePlannedPolls(supabase, upsertPoll(store, week, { ...poll, publishedAt: now, surveyId }, israelToday()));
      return NextResponse.json({ ok: true, surveyId });
    }
    await savePlannedPolls(supabase, upsertPoll(store, week, poll, israelToday()));
    return NextResponse.json({ ok: true, id: poll.id });
  } catch (err) {
    console.error('[week-setup/polls] failed', err);
    return NextResponse.json({ error: 'Failed to save the poll' }, { status: 500 });
  }
}

// DELETE /api/week-setup/polls { week, id } — take back a poll that hasn't gone yet.
export async function DELETE(request: Request) {
  const g = await gate(request);
  if ('denied' in g) return g.denied;
  const body = await request.json().catch(() => null);
  const week = typeof body?.week === 'string' && SUNDAY.test(body.week) ? body.week : null;
  const id = typeof body?.id === 'string' && UUID.test(body.id) ? body.id : null;
  if (!week || !id) return NextResponse.json({ error: 'week and id are required' }, { status: 400 });
  const supabase = createServerClient();
  const store = await loadPlannedPolls(supabase);
  if ((store[week] || []).find((p) => p.id === id)?.publishedAt) return NextResponse.json({ error: 'already sent' }, { status: 409 });
  await savePlannedPolls(supabase, removePoll(store, week, id, israelToday()));
  return NextResponse.json({ ok: true });
}

const emailOf = (c: VerifiedCaller) => c.email || '';
