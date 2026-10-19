import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';
import { deviceFromUa, recordOnbEvent } from '@/lib/onboarding/events';
import { isSyntheticAuthEmail } from '@/lib/auth/athlete-identity';
import { announceSignupRequest } from '@/lib/signup-queue';
import { notifyRegistrationReceived } from '@/lib/email';
import { COACH_ID } from '@/lib/constants';

export const dynamic = 'force-dynamic';

// The address a Strava sign-in is told on — "how will we tell you you're in?".
//
// Strava gives us no email, so the only address on file is the synthetic
// strava_<id>@strava.madregot.local, and an iPhone Safari tab cannot receive a
// push. Everyone like that who waited days for approval was lost (analysis
// 2026-10-10: 1 of 7 left an address while it was optional). Since 2026-10-19 the
// waiting screen REQUIRES it: GET says whether it is still missing, POST saves it.
//
// The address goes on their PENDING signup request (migration 140), never onto the
// athlete row — a real address there would stop requireSession matching their
// Strava login (see the synthetic-email note in lib/auth). Read by both approval
// routes to send the "you're in" mail.
//
// The first save is also when the approvers hear about them (announceSignupRequest):
// queuePendingStravaSignup holds the alert back until there is someone to tell.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type Db = ReturnType<typeof createServerClient>;

async function pendingRequest(db: Db, athleteId: string) {
  const { data, error } = await db.from('signup_requests')
    .select('id, email, notify_email')
    .eq('athlete_id', athleteId).eq('status', 'pending')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  return { row: data as { id: string; email: string; notify_email: string | null } | null, error };
}

export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  const athleteId = auth.user.athleteId;
  if (!athleteId) return NextResponse.json({ needed: false, email: null });
  const db = createServerClient();
  const { data: athlete } = await db.from('athletes').select('email, name').eq('id', athleteId).maybeSingle();
  // A real address on the row means the ordinary mails already reach them.
  if (!isSyntheticAuthEmail((athlete as { email?: string | null } | null)?.email)) return NextResponse.json({ needed: false, email: null });
  const { row } = await pendingRequest(db, athleteId);
  return NextResponse.json({
    needed: true,
    email: row?.notify_email ?? null,
    name: (athlete as { name?: string | null } | null)?.name ?? null,
  });
}

export async function POST(request: Request) {
  const auth = await requireSession(request);
  // Exempt from the approval gate (lib/auth/approval-gate), so a pending member gets here.
  if (!auth.ok) return authError(auth);
  const athleteId = auth.user.athleteId;
  if (!athleteId) return NextResponse.json({ error: 'no-athlete' }, { status: 400 });
  const { email, groupId } = (await request.json().catch(() => ({}))) as { email?: string; groupId?: string | null };
  const clean = String(email || '').trim().toLowerCase();
  if (!EMAIL.test(clean) || clean.endsWith('.local')) return NextResponse.json({ error: 'bad-email' }, { status: 400 });

  const db = createServerClient();
  const { data: athlete } = await db.from('athletes').select('email, name, group_id, approved').eq('id', athleteId).maybeSingle();
  const a = athlete as { email?: string | null; name?: string | null; group_id?: string | null; approved?: boolean | null } | null;
  if (!a) return NextResponse.json({ error: 'no-athlete' }, { status: 400 });

  const { row, error: readError } = await pendingRequest(db, athleteId);
  if (readError && (readError.code === '42703' || readError.code === 'PGRST204')) return NextResponse.json({ error: 'not-ready' }, { status: 503 });
  if (readError) return NextResponse.json({ error: 'failed' }, { status: 500 });

  const first = !row?.notify_email;
  const changed = row?.notify_email !== clean;
  let requestEmail = row?.email || (a.email ?? '');
  if (row) {
    if (changed) {
      const { error } = await db.from('signup_requests').update({ notify_email: clean }).eq('id', row.id);
      if (error) return NextResponse.json({ error: 'failed' }, { status: 500 });
    }
  } else if (a.approved !== true) {
    // No open request (it failed to insert at sign-in, or predates the queue): open
    // one now, or nobody would ever see them waiting.
    const { error } = await db.from('signup_requests').insert({
      email: a.email, status: 'pending', athlete_id: athleteId, source: 'strava-login', notify_email: clean,
    });
    if (error && error.code !== '23505') return NextResponse.json({ error: 'failed' }, { status: 500 });
    requestEmail = a.email ?? '';
  }

  // The pace group they think they belong to, so the approver doesn't meet "no group".
  // Theirs to suggest only while nobody has placed them; the approver can still change it.
  let groupName: string | null = null;
  if (groupId && !a.group_id && a.approved !== true) {
    const { data: g } = await db.from('groups').select('id, name').eq('id', groupId).eq('coach_id', COACH_ID).maybeSingle();
    if (g) {
      await db.from('athletes').update({ group_id: (g as { id: string }).id }).eq('id', athleteId);
      groupName = (g as { name: string }).name;
    }
  }

  // "We got it" to the new address, at once: the wrong address shows up as a mail that
  // never came, while they are still looking at the screen that lets them fix it.
  if (changed && a.approved !== true) {
    await notifyRegistrationReceived({ email: clean, name: a.name ?? null }).catch(() => undefined);
  }
  if (first && a.approved !== true) {
    await announceSignupRequest({ athleteId, email: requestEmail || a.email || clean, groupName, contactEmail: clean });
  }
  await recordOnbEvent({ step: 'notify_email_left', athleteId, device: deviceFromUa(request.headers.get('user-agent')), meta: { first } });
  return NextResponse.json({ ok: true, saved: true, email: clean });
}
