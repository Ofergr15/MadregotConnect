import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { notifyAdminNewAcademyRegistration, notifyAcademyFormReceived } from '@/lib/email';
import { formNameProblem, normalizeDisplayName } from '@/lib/names/latin';
import { clientIp, createRateLimiter, isBotSubmit } from '@/lib/academy/intake';
import { invitePrefill, recordFormCandidate } from '@/lib/academy/intake-server';

export const dynamic = 'force-dynamic';

// Registration accepts direct-link sign-ups; only the landing-page buttons are
// hidden. Keep in sync with REGISTRATION_OPEN in
// src/app/academy-register/page.tsx. Flip to false to fully close registration.
const REGISTRATION_OPEN = true;

// Every submit mails the admin and the typed address, so a script hammering this
// public endpoint is a spam cannon. Five a minute from one address is more than a
// person correcting a typo ever needs. Best effort per instance: see intake.ts.
const allowSubmit = createRateLimiter(5, 60_000);

/**
 * GET /api/academy/register?i={invite token} — the prefill for a personal link.
 * Name, email and phone of that one card, or `{ prefill: null }` for anything else
 * (unknown, stale, malformed): the form then simply opens empty.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('i');
  try {
    const prefill = await invitePrefill(createServerClient() as any, token);
    return NextResponse.json({ prefill });
  } catch {
    return NextResponse.json({ prefill: null });
  }
}

/**
 * POST /api/academy/register — public academy sign-up.
 * Body: { name, email, phone?, intake?, inviteToken?, src?, website? }
 * Creates an unapproved academy applicant, puts them on the funnel board with the
 * form step done (see recordFormCandidate), emails the coach to review and the
 * applicant to say it arrived. Staff accept from the funnel card, which mails a
 * link to /join/{token}.
 *
 * `website` is the honeypot (intake.ts): filled means a bot, answered like a success.
 */
export async function POST(request: Request) {
  try {
    if (!REGISTRATION_OPEN) {
      return NextResponse.json(
        { error: 'Academy registration is currently closed.' },
        { status: 403 }
      );
    }

    if (!allowSubmit(clientIp(request.headers))) {
      return NextResponse.json({ error: 'Too many attempts, try again in a minute' }, { status: 429 });
    }

    const body = await request.json().catch(() => null);
    if (isBotSubmit(body)) return NextResponse.json({ success: true });
    const { name, email, phone, intake, inviteToken, src } = body || {};
    if (!name?.trim() || !email?.trim()) {
      return NextResponse.json({ error: 'Name and email are required' }, { status: 400 });
    }
    // Hebrew or English (formNameProblem): the Strava connection at /join puts the
    // Latin name on the roster later. Only a name with no letters at all is refused.
    if (formNameProblem(name)) {
      return NextResponse.json({ error: 'Please write your name', code: 'no-letters' }, { status: 400 });
    }
    const fullName = normalizeDisplayName(name);

    const supabase = createServerClient();
    const normEmail = email.toLowerCase().trim();

    // Reuse an existing row for this email if present (re-registration), else insert.
    const { data: existing } = await supabase
      .from('athletes')
      .select('id, approved, invite_token, onboarding_status')
      .eq('coach_id', COACH_ID)
      .eq('email', normEmail)
      .maybeSingle();

    // Only a row that is ITSELF a pending academy application may be rewritten from here.
    // This endpoint is public and unauthenticated, and the row below sets approved:false,
    // role 'academy_user' and status 'invited' — applied to anybody else's row it logged a
    // club member out to the waiting room and stripped a coach's staff role (`role` is what
    // requireStaff reads), for whoever typed that member's address into the form. An existing
    // member who really wants the academy is a real case, and it is the coach's to act on:
    // the row stays exactly as it is, the coach gets the same email marked as an existing
    // member, and the funnel's link action is what flags them. The answer is the same
    // success either way, so the form cannot be used to learn whose address is on the roster.
    const phoneValue = typeof phone === 'string' ? phone.trim() || null : null;
    const afterSave = async (athleteId: string | null, existingMember: boolean) => {
      const candidateId = await recordFormCandidate(supabase as any, {
        name: fullName, email: normEmail, phone: phoneValue, inviteToken, src, athleteId,
      });
      await notifyAdminNewAcademyRegistration({
        name: fullName, email: normEmail, phone, existingMember, candidateId,
        intake: intake && typeof intake === 'object' ? intake : null,
      });
      await notifyAcademyFormReceived({ email: normEmail, name: fullName, candidateId, athleteId });
    };

    if (existing && existing.onboarding_status !== 'academy_pending') {
      await afterSave(null, true);
      return NextResponse.json({ success: true });
    }

    const token = existing?.invite_token || randomBytes(16).toString('hex');

    const row: Record<string, any> = {
      coach_id: COACH_ID,
      name: fullName,
      email: normEmail,
      phone: phone?.trim() || null,
      status: 'invited',
      is_academy: true,
      role: 'academy_user',
      approved: false,
      onboarding_status: 'academy_pending',
      invite_token: token,
      academy_intake: intake && typeof intake === 'object' ? intake : null,
    };

    let error;
    let athleteId: string | null = existing?.id ?? null;
    if (existing) {
      ({ error } = await supabase.from('athletes').update(row).eq('id', existing.id));
    } else {
      let inserted;
      ({ data: inserted, error } = await supabase.from('athletes').insert(row).select('id').single());
      if (inserted) athleteId = inserted.id;
    }
    // If some columns don't exist yet (unmigrated), retry with the minimal set.
    if (error) {
      const minimal = { coach_id: COACH_ID, name: fullName, email: normEmail, status: 'invited', invite_token: token };
      if (existing) ({ error } = await supabase.from('athletes').update(minimal).eq('id', existing.id));
      else {
        let inserted;
        ({ data: inserted, error } = await supabase.from('athletes').insert(minimal).select('id').single());
        if (inserted) athleteId = inserted.id;
      }
      if (error) throw error;
    }

    await afterSave(athleteId, false);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Academy register error:', error);
    return NextResponse.json({ error: error.message || 'Registration failed' }, { status: 500 });
  }
}
