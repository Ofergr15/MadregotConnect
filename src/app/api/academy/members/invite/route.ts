import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { createServerClient } from '@/lib/supabase/server';
import { APP_URL, COACH_ID } from '@/lib/constants';
import { requireAcademyManager, setPairCoaches } from '@/lib/academy/pairing-server';
import { holdsAcademyCoachRole } from '@/lib/academy/coaches';
import { isMissingColumn } from '@/lib/supabase/schema-drift';
import { israelToday } from '@/lib/utils';
import { notifyAcademyMoveIn } from '@/lib/email';
import { notifyAthlete } from '@/lib/push';
import { academyTraineesAssignedCopy } from '@/lib/notifications/copy';
import { academyThreadUrl } from '@/lib/academy/deep-links';
import { joinHebrewList } from '@/lib/academy/trainee-coaches';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/academy/members/invite — somebody who ALREADY trains in the academy and is not in
 * the app yet (the migration path, mockup screens 3–4): `{ name, email, phone?, coachIds?,
 * bandId?, groupId?, trainingSince? }`.
 *
 * One pre-approved row, already in the academy: status 'invited', approved, is_academy, with
 * the coaches, the band and the pace group (so the club week reaches them until their first
 * personal week), and a funnel card that says 'existing'. The personal /join/{token} link is
 * the whole journey from here: no form, no "waiting for approval". The email is required: it
 * is how they sign in (and the athletes row cannot exist without one).
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

    const token = randomBytes(16).toString('hex');
    const row: Record<string, unknown> = {
      coach_id: COACH_ID, name, email, status: 'invited', approved: true, invite_token: token,
      is_academy: true, academy_joined_on: israelToday(),
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
      console.error('academy invite insert failed:', ins.error);
      return NextResponse.json({ error: 'Failed to create the invitation' }, { status: 500 });
    }
    const athleteId = (ins.data as { id: string }).id;
    if (coachIds.length) {
      const paired = await setPairCoaches(athleteId, coachIds, 'עבר לאפליקציה');
      if (!paired.ok) console.warn('academy invite: coaches not set for', athleteId);
    }
    await supabase.from('academy_candidates').insert({ name, source: 'existing', athlete_id: athleteId, accepted_at: new Date().toISOString(), ...(phone ? { phone } : {}), email });

    // The way in, by email (Ofer, 2026-10-19), unless the manager asked for the link only —
    // and the coaches hear now that the trainee is theirs, so the plan can start.
    const { data: coachRows } = coachIds.length
      ? await supabase.from('athletes').select('id, name').in('id', coachIds)
      : { data: [] as Array<{ id: string; name: string | null }> };
    const coachNames = ((coachRows || []) as Array<{ id: string; name: string | null }>).map((c) => (c.name || '').trim().split(/\s+/)[0]).filter(Boolean);
    let emailed = false;
    if (b.sendEmail !== false) {
      const sent = await notifyAcademyMoveIn({ email, name, token, coachName: joinHebrewList(coachNames), coachCount: coachNames.length, athleteId })
        .catch((err: unknown) => { console.error('academy invite: move-in email failed:', err); return null; });
      emailed = !!sent && sent.ok;
    }
    await Promise.all(coachIds.filter((c) => c !== caller.athleteId).map((c) => notifyAthlete({
      athleteId: c, kind: 'academy_trainee_assigned', actorAthleteId: caller.athleteId,
      copy: (locale) => academyTraineesAssignedCopy(locale, { names: [name] }),
      url: academyThreadUrl({ recipientIsStaff: true, traineeId: athleteId }),
      tag: `academy-trainee-${athleteId}`,
    }).catch((err: unknown) => console.error('academy invite: coach push failed:', err))));

    return NextResponse.json({ athleteId, url: `${APP_URL}/join/${token}`, invitedBy: caller.athleteId, emailed });
  } catch (error) {
    console.error('POST /api/academy/members/invite error:', error);
    return NextResponse.json({ error: 'Failed to create the invitation' }, { status: 500 });
  }
}
