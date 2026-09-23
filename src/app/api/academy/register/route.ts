import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { notifyAdminNewAcademyRegistration } from '@/lib/email';
import { nameProblem, normalizeDisplayName } from '@/lib/names/latin';

export const dynamic = 'force-dynamic';

// Registration accepts direct-link sign-ups; only the landing-page buttons are
// hidden. Keep in sync with REGISTRATION_OPEN in
// src/app/academy-register/page.tsx. Flip to false to fully close registration.
const REGISTRATION_OPEN = true;

/**
 * POST /api/academy/register — public academy sign-up.
 * Body: { name, email, phone? }
 * Creates an unapproved academy applicant and emails the coach to review.
 * After approval (existing /api/admin/approve + Settings queue), the applicant
 * gets a link to /join/academy/{token} to connect Garmin.
 */
export async function POST(request: Request) {
  try {
    if (!REGISTRATION_OPEN) {
      return NextResponse.json(
        { error: 'Academy registration is currently closed.' },
        { status: 403 }
      );
    }

    const { name, email, phone, intake } = await request.json();
    if (!name?.trim() || !email?.trim()) {
      return NextResponse.json({ error: 'Name and email are required' }, { status: 400 });
    }
    // The form asks for the name in English and checks it before submitting; this
    // is the same rule on the server, because the form is a public endpoint and
    // this row becomes a roster row. See src/lib/names/latin.ts.
    if (nameProblem(name) === 'not-latin') {
      return NextResponse.json(
        { error: 'Please write your name in English letters', code: 'not-latin' },
        { status: 400 },
      );
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
    if (existing && existing.onboarding_status !== 'academy_pending') {
      try {
        await notifyAdminNewAcademyRegistration({ name: fullName, email: normEmail, phone, existingMember: true });
      } catch (e) {
        console.error('Academy registration email failed:', e);
      }
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
    if (existing) {
      ({ error } = await supabase.from('athletes').update(row).eq('id', existing.id));
    } else {
      ({ error } = await supabase.from('athletes').insert(row));
    }
    // If some columns don't exist yet (unmigrated), retry with the minimal set.
    if (error) {
      const minimal = { coach_id: COACH_ID, name: fullName, email: normEmail, status: 'invited', invite_token: token };
      if (existing) ({ error } = await supabase.from('athletes').update(minimal).eq('id', existing.id));
      else ({ error } = await supabase.from('athletes').insert(minimal));
      if (error) throw error;
    }

    try {
      await notifyAdminNewAcademyRegistration({ name: fullName, email: normEmail, phone });
    } catch (e) {
      console.error('Academy registration email failed:', e);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Academy register error:', error);
    return NextResponse.json({ error: error.message || 'Registration failed' }, { status: 500 });
  }
}
