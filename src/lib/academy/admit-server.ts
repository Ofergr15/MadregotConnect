import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { isStaffRole, type VerifiedCaller } from '@/lib/auth/self-or-staff';
import { isMissingColumn } from '@/lib/supabase/schema-drift';
import { releaseFromMaintenance } from '@/lib/maintenance-release';
import {
  academyAcceptedEmail, academyInviteEmail, notifyAcademyAccepted, notifyAcademyInvite,
  type BuiltEmail, type SendResult,
} from '@/lib/email';
import { notifyAthlete } from '@/lib/push';
import { approvalCopy } from '@/lib/notifications/copy';
import { inviteUrl, isInviteFresh } from './intake';
import { isAcademyManager, setPairCoaches } from './pairing-server';
import { coachIdsOf, hasTraineeCoachesTable, joinHebrewList } from './trainee-coaches';
import { applyAcademyMembership } from './membership-server';
import { holdsAcademyCoachRole } from '@/lib/academy/coaches';

/**
 * The funnel's two outward actions: send somebody the form, and let them in.
 *
 * Both are open to the manager and to academy coaches (canAdmitToAcademy); both
 * have a preview that builds the very mail the send would, so the sheet shows what
 * will arrive. Neither is reachable from outside staff.
 */

const NEEDS_126 = () =>
  NextResponse.json(
    { error: 'Invites are not available yet — migration 126 has not been applied.', code: 'needs-126' },
    { status: 409 },
  );

type Card = { id: string; name: string; email: string | null; athlete_id: string | null; invite_token?: string | null; invited_at?: string | null };

async function callerName(caller: VerifiedCaller): Promise<string | null> {
  if (!caller.athleteId) return null;
  const { data } = await createServerClient().from('athletes').select('name').eq('id', caller.athleteId).maybeSingle();
  return (data?.name as string) || null;
}

async function readCard(id: string): Promise<{ card: Card | null; hasInviteColumns: boolean }> {
  const supabase = createServerClient();
  const full = await supabase
    .from('academy_candidates')
    .select('id, name, email, athlete_id, invite_token, invited_at')
    .eq('id', id)
    .maybeSingle();
  if (!full.error) return { card: (full.data as Card) ?? null, hasInviteColumns: true };
  if (!isMissingColumn(full.error)) throw full.error;
  const base = await supabase.from('academy_candidates').select('id, name, email, athlete_id').eq('id', id).maybeSingle();
  if (base.error) throw base.error;
  return { card: (base.data as Card) ?? null, hasInviteColumns: false };
}

/**
 *   { action: 'invite', note?, send?: boolean, preview?: boolean }
 *
 * `send: false` is "copy link" (for WhatsApp): the token is minted and stamped the
 * same way, only no mail goes. A link that went stale is refreshed, not replaced,
 * so an old WhatsApp message keeps working once it is re-sent.
 */
export async function inviteAction(id: string, caller: VerifiedCaller, body: any): Promise<Response> {
  const { card, hasInviteColumns } = await readCard(id);
  if (!card) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const note = String(body?.note || '').trim().slice(0, 500) || null;
  const senderName = await callerName(caller);
  const token = card.invite_token || randomBytes(16).toString('hex');
  const url = inviteUrl(token);

  if (body?.preview) {
    const built: BuiltEmail = academyInviteEmail({ name: card.name, url, note, senderName });
    return NextResponse.json({ to: card.email, ...built });
  }
  if (!hasInviteColumns) return NEEDS_126();
  const send = body?.send !== false;
  if (send && !card.email) {
    return NextResponse.json({ error: 'No email on this card — add one, or copy the link instead', code: 'no-email' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { error } = await createServerClient()
    .from('academy_candidates')
    .update({ invite_token: token, invited_at: now, updated_at: now })
    .eq('id', id);
  if (error) return NextResponse.json({ error: 'Failed to save the invite' }, { status: 500 });

  let email: SendResult | null = null;
  if (send) {
    email = await notifyAcademyInvite({ email: card.email!, name: card.name, url, note, senderName, candidateId: id });
  }
  return NextResponse.json({ ok: true, url, invitedAt: now, email, wasFresh: isInviteFresh(card.invited_at) });
}

/**
 *   { action: 'accept', coachIds?: string[], coachId?, preview?: boolean }
 *
 * Needs the athlete row: the form writes one for every applicant, and a card that
 * came some other way is linked first (the card's link row). Then, in order:
 *
 *   1. out of the maintenance window — as the approvals list does, and for the
 *      same reason: approving someone who then meets a closed door changes nothing
 *   2. approved + active, a join token, and `is_academy`
 *   3. the coaches (setPairCoaches, same trail as "שיבוץ מאמנים") — one or
 *      several since migration 135, all equal; `coachId` is the one-coach form
 *   4. the "you're in" mail, and a push for whoever already has the app
 *
 * An academy coach accepts for themselves; the manager may name any academy coaches.
 */
export function acceptCoachIds(body: any, caller: VerifiedCaller, manager: boolean): string[] | { error: string; status: number } {
  const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const asked = Array.isArray(body?.coachIds)
    ? [...new Set((body.coachIds as unknown[]).map(clean).filter(Boolean))]
    : clean(body?.coachId) ? [clean(body?.coachId)] : [];
  if (!manager) {
    if (asked.some((c) => c !== caller.athleteId)) {
      return { error: 'An academy coach accepts trainees for themselves', status: 403 };
    }
    return caller.athleteId ? [caller.athleteId] : [];
  }
  return asked.length ? asked : caller.athleteId ? [caller.athleteId] : [];
}

export async function acceptAction(id: string, caller: VerifiedCaller, body: any): Promise<Response> {
  const { card } = await readCard(id);
  if (!card) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!card.athlete_id) {
    return NextResponse.json(
      { error: 'Link this card to the person’s account first — the form creates one', code: 'not-linked' },
      { status: 409 },
    );
  }

  const manager = isAcademyManager(caller);
  const picked = acceptCoachIds(body, caller, manager);
  if (!Array.isArray(picked)) return NextResponse.json({ error: picked.error }, { status: picked.status });
  if (!picked.length) return NextResponse.json({ error: 'Pick the coach' }, { status: 400 });
  if (picked.includes(card.athlete_id)) {
    return NextResponse.json({ error: 'A trainee cannot be their own coach' }, { status: 400 });
  }

  const supabase = createServerClient();
  const coaches: Array<{ id: string; name: string }> = [];
  for (const cid of picked) {
    const { data: coach } = await supabase
      .from('athletes').select('id, name, role, extra_roles').eq('id', cid).eq('coach_id', COACH_ID).maybeSingle();
    if (!coach || !holdsAcademyCoachRole(coach)) {
      return NextResponse.json({ error: 'That coach is not an academy coach in this club' }, { status: 400 });
    }
    coaches.push({ id: coach.id, name: coach.name });
  }
  const coachId = coaches[0].id;
  const coachName = joinHebrewList(coaches.map((c) => c.name));

  const { data: athlete, error: athleteError } = await supabase
    .from('athletes')
    .select('id, name, email, approved, is_academy, invite_token, academy_coach_id')
    .eq('id', card.athlete_id)
    .eq('coach_id', COACH_ID)
    .maybeSingle();
  if (athleteError || !athlete) return NextResponse.json({ error: 'The linked account was not found' }, { status: 404 });

  // Somebody already approved (a club member) has an account to open, not one to set up.
  const needsJoin = !athlete.approved;
  const token = needsJoin ? athlete.invite_token || randomBytes(16).toString('hex') : null;
  const to = card.email || athlete.email;

  if (body?.preview) {
    const built = academyAcceptedEmail({ name: card.name || athlete.name, token: token || null, coachName, coachCount: coaches.length });
    return NextResponse.json({ to, ...built });
  }

  // Several coaches need 135. Refused before anything is written, so nobody is
  // let in with one coach of the two the manager picked.
  if (coaches.length > 1 && !(await hasTraineeCoachesTable(supabase))) {
    return NextResponse.json(
      { error: 'Several coaches per trainee need migration 135 — paste it first', code: 'no_schema' },
      { status: 409 },
    );
  }

  let released = false;
  try {
    released = (await releaseFromMaintenance({ id: athlete.id, email: athlete.email })).released;
  } catch (err) {
    console.error('Accept: failed to release from maintenance:', err);
  }

  const updates: Record<string, unknown> = { is_academy: true };
  if (needsJoin) {
    Object.assign(updates, {
      approved: true,
      approved_at: new Date().toISOString(),
      approved_by: caller.email || null,
      status: 'active',
      invite_token: token,
    });
  }
  const { error: updateError } = await supabase.from('athletes').update(updates).eq('id', athlete.id);
  if (updateError) {
    console.error('Accept: athlete update failed:', updateError);
    return NextResponse.json({ error: 'Failed to accept' }, { status: 500 });
  }

  // The academy join date, as every other door into the academy stamps it. Without
  // it a funnel trainee had no "since" on the members tab, and once removed was
  // findable in "עזבו" only through the coach history.
  await applyAcademyMembership(supabase, athlete.id, true);

  // The whole set, through the one write every "שיבוץ מאמנים" door uses.
  const before = await coachIdsOf(supabase, athlete.id, athlete.academy_coach_id ?? null);
  const coachIds = coaches.map((c) => c.id);
  const paired = before.length === coachIds.length && coachIds.every((c) => before.includes(c)) && before[0] === coachId
    ? true
    : (await setPairCoaches(athlete.id, coachIds, 'accepted from the funnel')).ok;

  const now = new Date().toISOString();
  const stamp = await supabase.from('academy_candidates').update({ accepted_at: now, updated_at: now }).eq('id', id);
  if (stamp.error && !isMissingColumn(stamp.error)) console.error('Accept: accepted_at failed:', stamp.error.message);

  const [email] = await Promise.all([
    to
      ? notifyAcademyAccepted({ email: to, name: card.name || athlete.name, token, coachName, coachCount: coaches.length, athleteId: athlete.id, candidateId: id })
      : Promise.resolve(null),
    notifyAthlete({
      athleteId: athlete.id,
      kind: 'approval',
      copy: (locale) => approvalCopy(locale, { name: athlete.name }),
      url: '/dashboard',
      tag: 'approval',
    }).catch((err: unknown) => console.error('Accept: push failed:', err)),
  ]);

  return NextResponse.json({ ok: true, coachId, coachIds, coachName, paired, released, acceptedAt: now, email });
}
