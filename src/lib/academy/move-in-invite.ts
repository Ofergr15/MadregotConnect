import { randomBytes } from 'crypto';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { setPairCoaches } from './pairing-server';
import { holdsAcademyCoachRole } from './coaches';
import { isMissingColumn } from '@/lib/supabase/schema-drift';
import { notifyAcademyExistingForm } from '@/lib/email';
import { inviteUrl } from './intake';
import type { VerifiedCaller } from '@/lib/auth/self-or-staff';

/**
 * The move-in invitation (somebody who ALREADY trains in the academy and is not in the app):
 * a row waiting for the form and the approval, with the coaches already on it, and a funnel
 * card that says 'existing'. The trainee gets the details form by email.
 *
 * One function for both doors: the manager's one-by-one form (POST /api/academy/members/invite)
 * and the import from the academy's file (POST /api/academy/import, action 'invite'), which
 * passes the card it made at import (`cardId`) and what the file already says about the person
 * (`athleteExtras`, `intake`) — so the row starts with them and the card is not made twice.
 */

export interface MoveInInput {
  name: string;
  email: string;
  phone?: string;
  coachIds: string[];
  bandId?: string | null;
  groupId?: string | null;
  trainingSince?: string | null;
  sendEmail?: boolean;
  /** An existing card to use (the import's), instead of opening a new one. */
  cardId?: string | null;
  /** Columns the file already filled (height_cm, weight_kg, sizes, academy_intake). */
  athleteExtras?: Record<string, unknown>;
}

export interface MoveInResult {
  status: number;
  body: Record<string, unknown>;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createMoveInInvite(caller: VerifiedCaller, input: MoveInInput): Promise<MoveInResult> {
  const name = input.name.trim().slice(0, 80);
  const email = input.email.trim().toLowerCase();
  const phone = (input.phone || '').trim().slice(0, 30);
  if (!name) return { status: 400, body: { error: 'name is required' } };
  if (!EMAIL_RE.test(email)) return { status: 400, body: { error: 'email is required', fields: ['email'] } };

  const supabase = createServerClient();
  const { data: existing } = await supabase.from('athletes').select('id, name, status').eq('email', email).maybeSingle();
  if (existing) {
    return { status: 409, body: { error: 'already_in_app', athleteId: (existing as { id: string }).id, name: (existing as { name: string }).name } };
  }
  for (const c of input.coachIds) {
    const { data: coach } = await supabase.from('athletes').select('id, role, extra_roles').eq('id', c).maybeSingle();
    if (!coach || !holdsAcademyCoachRole(coach as never)) return { status: 400, body: { error: 'Not an academy coach', coachId: c } };
  }

  // Two tokens: the form's (the card's, /academy-register?i=) and the way into the app
  // (/join, sent with the install mail once the manager approves).
  const token = randomBytes(16).toString('hex');
  const formToken = randomBytes(16).toString('hex');
  const extras = input.athleteExtras ?? {};
  const row: Record<string, unknown> = {
    coach_id: COACH_ID, name, email, status: 'invited', approved: false, invite_token: token,
    is_academy: true, role: 'academy_user', onboarding_status: 'academy_pending',
    ...(phone ? { phone } : {}), ...(input.bandId ? { academy_band_id: input.bandId } : {}), ...(input.groupId ? { group_id: input.groupId } : {}),
    ...(input.trainingSince ? { academy_training_since: input.trainingSince } : {}),
    ...extras,
  };
  let ins = await supabase.from('athletes').insert(row).select('id').single();
  // A column this database does not have (before migration 149/155): drop what the table cannot hold.
  if (ins.error && isMissingColumn(ins.error)) {
    delete row.academy_training_since; delete row.phone;
    for (const k of Object.keys(extras)) if (k !== 'academy_intake') delete row[k];
    ins = await supabase.from('athletes').insert(row).select('id').single();
  }
  if (ins.error || !ins.data) {
    console.error('academy invite: insert failed:', ins.error);
    return { status: 500, body: { error: 'Failed to create the invitation' } };
  }
  const athleteId = (ins.data as { id: string }).id;
  if (input.coachIds.length) {
    const paired = await setPairCoaches(athleteId, input.coachIds, 'עבר לאפליקציה');
    if (!paired.ok) console.warn('academy invite: coaches not set for', athleteId);
  }

  const now = new Date().toISOString();
  let candidateId: string | null = null;
  if (input.cardId) {
    // The import's card becomes the move-in's: the form reads source 'existing', and the
    // migration board lists it. Its intake (the file's answers) stays as it is.
    const { data: card, error } = await supabase.from('academy_candidates')
      .update({ name, source: 'existing', athlete_id: athleteId, email, invite_token: formToken, invited_at: now, updated_at: now, ...(phone ? { phone } : {}) })
      .eq('id', input.cardId).select('id').maybeSingle();
    if (error) console.error('academy invite: card update failed:', error.message);
    candidateId = (card as { id: string } | null)?.id ?? null;
  } else {
    const { data: card } = await supabase.from('academy_candidates').insert({
      name, source: 'existing', athlete_id: athleteId, email, invite_token: formToken, invited_at: now,
      ...(phone ? { phone } : {}),
    }).select('id').single();
    candidateId = (card as { id: string } | null)?.id ?? null;
  }

  // The details form, by email, unless the manager asked for the link only. The coaches hear
  // nothing yet: at the approval, and when the trainee signs in.
  const url = inviteUrl(formToken);
  let emailed = false;
  if (input.sendEmail !== false && candidateId) {
    const sent = await notifyAcademyExistingForm({ email, name, url, candidateId, athleteId })
      .catch((err: unknown) => { console.error('academy invite: form email failed:', err); return null; });
    emailed = !!sent && sent.ok;
  }
  return { status: 200, body: { athleteId, candidateId, url, invitedBy: caller.athleteId, emailed } };
}
