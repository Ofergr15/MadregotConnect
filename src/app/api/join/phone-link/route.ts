import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { notifyPhoneLink } from '@/lib/email';
import { deviceFromUa, recordOnbEvent } from '@/lib/onboarding/events';

export const dynamic = 'force-dynamic';

// POST /api/join/phone-link { token } — mail the member their own join link, to
// open on the phone ("Continue on the phone", components/install/ContinueOnPhone).
//
// Public like the rest of /join: the invite token is the credential. It only ever
// mails the address already on that invite row, never one the caller supplies, so
// it can't be used to send mail to a stranger. One mail per invite per 2 minutes.
const COOLDOWN_MS = 2 * 60 * 1000;

export async function POST(request: Request) {
  const { token } = (await request.json().catch(() => ({}))) as { token?: string };
  if (!token || typeof token !== 'string' || token.length < 16) return NextResponse.json({ error: 'bad-token' }, { status: 400 });
  const db = createServerClient();
  const { data: a } = await db.from('athletes').select('id, name, email').eq('invite_token', token).maybeSingle();
  const athlete = a as { id: string; name: string | null; email: string | null } | null;
  if (!athlete?.email) return NextResponse.json({ error: 'unknown' }, { status: 404 });
  const since = new Date(Date.now() - COOLDOWN_MS).toISOString();
  const { count } = await db.from('email_log').select('id', { count: 'exact', head: true })
    .eq('template', 'phone_link').eq('athlete_id', athlete.id).gte('created_at', since);
  if ((count ?? 0) > 0) return NextResponse.json({ ok: true, throttled: true });
  const r = await notifyPhoneLink({ email: athlete.email, token, name: athlete.name, athleteId: athlete.id });
  if (!r.ok) return NextResponse.json({ error: 'send-failed' }, { status: 502 });
  await recordOnbEvent({ step: 'phone_link_mailed', athleteId: athlete.id, device: deviceFromUa(request.headers.get('user-agent')) });
  const at = athlete.email.indexOf('@');
  return NextResponse.json({ ok: true, to: `${athlete.email.slice(0, 1)}•••${athlete.email.slice(at)}` });
}
