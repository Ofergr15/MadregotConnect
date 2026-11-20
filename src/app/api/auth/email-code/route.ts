import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@/lib/supabase/server';
import { createSyntheticSession } from '@/lib/auth/synthetic-session';
import { DEVICE_COOKIE, DEVICE_COOKIE_OPTIONS, signDeviceToken } from '@/lib/auth/device-token';
import { CODE_TTL_MS, MAX_ATTEMPTS, MAX_SENDS, SEND_WINDOW_MS, codeMatches, hashCode, newCode, normaliseCode } from '@/lib/auth/email-code';
import { isLikelyEmail, normaliseEmail } from '@/lib/signup';
import { notifyLoginCode } from '@/lib/email';
import { deviceFromUa, recordOnbEvent } from '@/lib/onboarding/events';
import { clientIp, createRateLimiter } from '@/lib/academy/intake';

export const dynamic = 'force-dynamic';

// POST /api/auth/email-code
//   { action: 'send', email }          -> { ok: true }   (always, see below)
//   { action: 'verify', email, code }  -> { ok, session, athleteId, … } | 401
//
// Sign in with a 6-digit code (lib/auth/email-code). Only to an address that is
// on an APPROVED athlete row, which is the identity requireSession resolves a
// session to, so the session minted here lands on exactly that member.
//
// "send" answers ok whether or not the address belongs to anyone: saying "no such
// member" would let the form test addresses. The screen says "if it is registered
// with us, a code is on its way", which is true either way.

type Db = ReturnType<typeof createServerClient>;

// Rate limits that run BEFORE anything looks at membership, so they bite a member and a
// stranger alike (the old per-address counter only ever counted members, and its 429
// was the membership oracle). Keyed per person and, much higher, per IP — a club event
// shares one Wi-Fi. Best effort per instance, the same as academy/register.
const allowPerson = createRateLimiter(5, 60_000);
const allowFromIp = createRateLimiter(40, 60_000);

/** Every failed verify answers this, whatever the reason: no code, expired, used up or wrong. */
const BAD_CODE = { error: 'wrong-code' } as const;
const badCode = () => NextResponse.json(BAD_CODE, { status: 401 });

async function memberFor(supabase: Db, email: string) {
  const { data } = await supabase
    .from('athletes')
    .select('id, email, name, group_id, status, approved, role, is_academy')
    .eq('email', email)
    .maybeSingle();
  if (!data || data.approved !== true || data.status === 'removed' || data.status === 'disconnected') return null;
  return data;
}

/**
 * The address behind a personal join link — the installed app's first open
 * (/welcome?t=…, onboarding v2) signs in by the link alone, so a member never
 * types an address the club already has. The token IS the invitation; anyone
 * holding it was sent it, and the code still goes only to the member's inbox.
 */
async function emailForToken(supabase: Db, token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(token)) return null;
  const { data } = await supabase.from('athletes').select('email').eq('invite_token', token).maybeSingle();
  return data?.email ? normaliseEmail(data.email) : null;
}

/** n•••@gmail.com — enough to recognise your own address, not enough to harvest one. */
function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  return `${user.slice(0, 1)}•••@${domain}`;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const supabase = createServerClient();
  const token = typeof body?.token === 'string' ? body.token : '';
  const email = token
    ? (await emailForToken(supabase, token)) || ''
    : normaliseEmail(typeof body?.email === 'string' ? body.email : '');
  if (!isLikelyEmail(email)) return NextResponse.json({ error: token ? 'unknown-link' : 'invalid-email' }, { status: token ? 404 : 400 });

  // The welcome screen's greeting: who this link belongs to, never the full address.
  if (body?.action === 'who') {
    // Only a join link may ask whose it is. Answered for a bare address, this told
    // anybody "member, first name X" versus 404 — the probe `send` refuses to be.
    // Same status and body as an unknown link, so the two cannot be told apart.
    if (!token) return NextResponse.json({ error: 'unknown-link' }, { status: 404 });
    const member = await memberFor(supabase, email);
    if (!member) return NextResponse.json({ error: 'unknown-link' }, { status: 404 });
    // The name they typed on the form (migration 131) reads better than the roster's
    // Latin placeholder, which for a /register applicant is made from the address.
    const { data: req } = await supabase.from('signup_requests').select('full_name').eq('athlete_id', member.id).not('full_name', 'is', null).limit(1).maybeSingle();
    const name = (req?.full_name as string | undefined) || member.name || '';
    return NextResponse.json({ firstName: name.split(/\s+/)[0] || null, maskedEmail: maskEmail(email) });
  }

  if (body?.action === 'send' || body?.action === 'verify') {
    const ip = clientIp(request.headers);
    if (!allowFromIp(ip) || !allowPerson(`${body.action}|${ip}|${email}`)) {
      return NextResponse.json({ error: 'too-many' }, { status: 429 });
    }
  }

  try {
    if (body?.action === 'send') {
      // From here on every outcome answers the same {ok:true}: a member, a stranger, a
      // member past the per-address cap and a server-side fault must not be told apart.
      const ok = () => NextResponse.json({ ok: true });
      const member = await memberFor(supabase, email);
      if (!member) return ok();
      const since = new Date(Date.now() - SEND_WINDOW_MS).toISOString();
      const { count } = await supabase.from('login_codes').select('id', { count: 'exact', head: true }).eq('email', email).gte('created_at', since);
      // Past the cap: no new code and no mail (each probe used to mail a real member).
      if ((count ?? 0) >= MAX_SENDS) { console.warn('[email-code] send cap reached'); return ok(); }
      const code = newCode();
      const hash = hashCode(email, code);
      if (!hash) { console.error('[email-code] not configured (no hash secret)'); return ok(); }
      const { error } = await supabase.from('login_codes').insert({ email, code_hash: hash, expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString() });
      // Migration 132 not pasted yet: logged, never told to the caller (members only reach it).
      if (error && (error.code === '42P01' || error.code === 'PGRST205')) { console.error('[email-code] login_codes missing'); return ok(); }
      if (error) throw error;
      const mail = await notifyLoginCode({ email, code, name: member.name, athleteId: member.id });
      if (!mail.ok) console.error('[email-code] mail not sent', mail.code, mail.reason);
      await recordOnbEvent({ step: 'code_sent', athleteId: member.id, device: deviceFromUa(request.headers.get('user-agent')), meta: { mailed: mail.ok } });
      return NextResponse.json({ ok: true });
    }

    if (body?.action === 'verify') {
      const code = normaliseCode(body?.code);
      if (code.length !== 6) return NextResponse.json({ error: 'bad-code' }, { status: 400 });
      const { data: row } = await supabase
        .from('login_codes')
        .select('id, code_hash, expires_at, attempts')
        .eq('email', email)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      // No code, expired, used up and wrong all answer badCode(): told apart, they said
      // "this address is a member who asked for a code".
      if (!row || Date.parse(row.expires_at) < Date.now() || row.attempts >= MAX_ATTEMPTS) return badCode();
      // Claim the attempt BEFORE comparing the code, atomically: the UPDATE matches only
      // while `attempts` still holds the value read above. Read-then-write let N parallel
      // guesses all pass the gate on the same count and try N codes against a limit of
      // MAX_ATTEMPTS. A correct code also spends a slot; the row is deleted on success.
      const { data: claimed } = await supabase
        .from('login_codes')
        .update({ attempts: row.attempts + 1 })
        .eq('id', row.id)
        .eq('attempts', row.attempts)
        .lt('attempts', MAX_ATTEMPTS)
        .select('id');
      if (!claimed || claimed.length === 0) return badCode();
      if (!codeMatches(email, code, row.code_hash)) return badCode();
      const member = await memberFor(supabase, email);
      if (!member) return badCode();
      // One use: every code for this address goes.
      await supabase.from('login_codes').delete().eq('email', email);
      // Approved but still 'invited' reads as "access removed" once inside; signing
      // in IS joining, the same flip /api/athletes/connect makes.
      if (member.status === 'invited') await supabase.from('athletes').update({ status: 'active' }).eq('id', member.id);

      const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const auth = await createSyntheticSession(admin, email, { athlete_id: member.id, name: member.name });
      if (auth.error || !auth.session) {
        console.error('[email-code] session mint failed:', auth.error);
        return NextResponse.json({ error: 'failed' }, { status: 500 });
      }
      await recordOnbEvent({ step: 'code_verified', athleteId: member.id, device: deviceFromUa(request.headers.get('user-agent')) });
      const response = NextResponse.json({
        ok: true,
        email,
        name: member.name,
        athleteId: member.id,
        groupId: member.group_id,
        role: (member as { role?: string | null }).role ?? null,
        isAcademy: !!(member as { is_academy?: boolean | null }).is_academy,
        session: auth.session,
      });
      const device = signDeviceToken(email);
      if (device) response.cookies.set(DEVICE_COOKIE, device, DEVICE_COOKIE_OPTIONS);
      return response;
    }

    return NextResponse.json({ error: 'bad-action' }, { status: 400 });
  } catch (err) {
    console.error('[email-code] failed:', err);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
