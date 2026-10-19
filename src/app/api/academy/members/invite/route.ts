import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { requireAcademyManager, setPairCoaches } from '@/lib/academy/pairing-server';
import { holdsAcademyCoachRole } from '@/lib/academy/coaches';
import { isMissingColumn } from '@/lib/supabase/schema-drift';
import { notifyAcademyExistingForm } from '@/lib/email';
import { inviteUrl } from '@/lib/academy/intake';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/academy/members/invite — somebody who ALREADY trains in the academy and is not in
 * the app yet (the migration path, mockup screens 3–4): `{ name, email, phone?, coachIds?,
 * bandId?, groupId?, trainingSince? }`.
 *
 * The same road as a new trainee, without the "who are you" (Ofer, 2026-10-19,
 * academy-onboarding/existing-trainee-flow.html): a row waiting for the form and the
 * approval, with the coaches, the band and the pace group already on it, and a funnel card
 * that says 'existing'. The trainee gets the details form by email; the manager is told the
 * form came back from an existing trainee; accepting (one tap — the coaches are preset)
 * sends the install mail. The email is required: it is how they sign in.
 *
 * Somebody already in the app is not invited — the answer names them, and the move-in tab is
 * the way. Manager only.
 */
export async function POST(request: Request) {
  try {
    const { denied, caller } = await requireAcademyManager(request);
    if (denied) return denied;
    const b = await request.json().catch(() => ({})) as Record<string, unknown>;
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 80) : '';
    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    const phone = typeof b.phone === 'string' ? b.phone.trim().slice(0, 30) : '';
    const coachIds = Array.isArray(b.coachIds) ? [...new Set(b.coachIds.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)))] : [];
    const bandId = typeof b.bandId === 'string' && UUID_RE.test(b.bandId) ? b.bandId : null;
    const groupId = typeof b.groupId === 'string' && UUID_RE.test(b.groupId) ? b.groupId : null;
    const since = typeof b.trainingSince === 'string' ? b.trainingSince.trim() : '';
    const trainingSince = /^\d{4}-\d{2}(-\d{2})?$/.test(since) ? (since.length === 7 ? `${since}-01` : since) : null;
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
    if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'email is required', fields: ['email'] }, { status: 400 });

    const supabase = createServerClient();
    const { data: existing } = await supabase.from('athletes').select('id, name, status').eq('email', email).maybeSingle();
    if (existing) {
      return NextResponse.json({ error: 'already_in_app', athleteId: (existing as { id: string }).id, name: (existing as { name: string }).name }, { status: 409 });
    }
    for (const c of coachIds) {
      const { data: coach } = await supabase.from('athletes').select('id, role, extra_roles').eq('id', c).maybeSingle();
      if (!coach || !holdsAcademyCoachRole(coach as never)) return NextResponse.json({ error: 'Not an academy coach', coachId: c }, { status: 400 });
    }

    // Two tokens: the form's (the card's, /academy-register?i=) and the way into the app
    // (/join, sent with the install mail once the manager approves).
    const token = randomBytes(16).toString('hex');
    const formToken = randomBytes(16).toString('hex');
    // Waiting for the form and the approval, like any applicant (the form updates this row,
    // the accept lets it in) — with the coaches already on it, so accepting is one tap.
    const row: Record<string, unknown> = {
      coach_id: COACH_ID, name, email, status: 'invited', approved: false, invite_token: token,
      is_academy: true, role: 'academy_user', onboarding_status: 'academy_pending',
      ...(phone ? { phone } : {}), ...(bandId ? { academy_band_id: bandId } : {}), ...(groupId ? { group_id: groupId } : {}),
      ...(trainingSince ? { academy_training_since: trainingSince } : {}),
    };
    let ins = await supabase.from('athletes').insert(row).select('id').single();
    // Before migration 149 (or without a phone column): drop what the table cannot hold.
    if (ins.error && isMissingColumn(ins.error)) {
      delete row.academy_training_since; delete row.phone;
      ins = await supabase.from('athletes').insert(row).select('id').single();
    }
    if (ins.error || !ins.data) {
      console.error('academy invite: insert failed:', ins.error);
      return NextResponse.json({ error: 'Failed to create the invitation' }, { status: 500 });
    }
    const athleteId = (ins.data as { id: string }).id;
    if (coachIds.length) {
      const paired = await setPairCoaches(athleteId, coachIds, 'עבר לאפליקציה');
      if (!paired.ok) console.warn('academy invite: coaches not set for', athleteId);
    }
    const { data: card } = await supabase.from('academy_candidates').insert({
      name, source: 'existing', athlete_id: athleteId, email, invite_token: formToken, invited_at: new Date().toISOString(),
      ...(phone ? { phone } : {}),
    }).select('id').single();
    const candidateId = (card as { id: string } | null)?.id ?? null;

    // The details form, by email (Ofer, 2026-10-19), unless the manager asked for the link
    // only. The coaches hear nothing yet: at the approval, and when the trainee signs in.
    const url = inviteUrl(formToken);
    let emailed = false;
    if (b.sendEmail !== false && candidateId) {
      const sent = await notifyAcademyExistingForm({ email, name, url, candidateId, athleteId })
        .catch((err: unknown) => { console.error('academy invite: form email failed:', err); return null; });
      emailed = !!sent && sent.ok;
    }
    return NextResponse.json({ athleteId, candidateId, url, invitedBy: caller.athleteId, emailed });
  } catch (error) {
    console.error('POST /api/academy/members/invite error:', error);
    return NextResponse.json({ error: 'Failed to create the invitation' }, { status: 500 });
  }
}
