import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { encrypt } from '@/lib/encryption';
import { mayActFor, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { deviceFromUa, recordOnbEvent } from '@/lib/onboarding/events';
import { sendWaitingAfterReconnect, withinMs } from '@/lib/watch/reconnect';

/**
 * Server-side home of the Garmin credential.
 *
 * `athletes.garmin_auth` decrypts to OAuth tokens that ARE the athlete's Garmin
 * account, so the blob never leaves the server: the exchange routes
 * (/api/garmin/authenticate, /api/garmin/ticket-auth) resolve WHICH row they are
 * connecting before they talk to Garmin, write the credential here, and answer
 * with a status only. Until 2026-11-21 they returned the encrypted blob and the
 * browser posted it back to /api/athletes/connect, which also meant any caller
 * could write arbitrary bytes into a row's credential column.
 *
 * Who may connect a row — three doors, the same three the join flows already had,
 * none wider than /api/athletes/connect's existing posture:
 *
 *  1. `inviteToken` — the token is the credential (unguessable, one row).
 *  2. A Supabase bearer — self, or staff naming `athleteId` (mayActFor).
 *  3. `signupEmail` WITH a verified bearer whose own email is that address — /join/onboard,
 *     reached from /auth/resolve after a Supabase sign-in, before the athlete row is
 *     linked to the session. Only a row that is NOT yet `active`. Without a bearer the
 *     address alone proves nothing: it used to let anyone write their Garmin credential
 *     onto another pending applicant's row and tell existing addresses from unknown ones
 *     (2026-11-22). An active row must come through door 2.
 */
export type GarminTarget = { athleteId: string };

export async function resolveGarminTarget(
  req: Request,
  supabase: SupabaseClient,
  body: { inviteToken?: unknown; athleteId?: unknown; signupEmail?: unknown },
): Promise<{ denied: Response } | { target: GarminTarget }> {
  if (typeof body.inviteToken === 'string' && body.inviteToken) {
    const { data } = await supabase
      .from('athletes')
      .select('id')
      .eq('invite_token', body.inviteToken)
      .maybeSingle();
    if (!data) return { denied: NextResponse.json({ error: 'Invalid or expired invite link' }, { status: 404 }) };
    return { target: { athleteId: data.id } };
  }

  if (!req.headers.get('authorization')) {
    return { denied: NextResponse.json({ error: 'Sign in to connect Garmin' }, { status: 401 }) };
  }
  const { denied, caller } = await resolveVerifiedCaller(req);
  if (denied) return { denied };

  // Door 3: a signed-in person finishing their own sign-up, named by their OWN verified
  // address. Any other address is refused the same way as a wrong athleteId.
  const signupEmail = typeof body.signupEmail === 'string' ? body.signupEmail.toLowerCase().trim() : '';
  const ownEmail = (caller.email || '').toLowerCase().trim();
  if (signupEmail && !(typeof body.athleteId === 'string' && body.athleteId)) {
    if (!ownEmail || signupEmail !== ownEmail) {
      return { denied: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
    }
    const { data } = await supabase
      .from('athletes')
      .select('id, status')
      .eq('email', signupEmail)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data && data.status !== 'active') return { target: { athleteId: data.id } };
    if (!data && !caller.athleteId) return { denied: NextResponse.json({ error: 'account_not_found' }, { status: 404 }) };
    // An active row (or a session already linked to one) is door 2's.
  }

  // Door 2: self, or staff naming athleteId.
  const wanted = typeof body.athleteId === 'string' && body.athleteId ? body.athleteId : caller.athleteId;
  if (!wanted || !mayActFor(caller, wanted)) {
    return { denied: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  }
  return { target: { athleteId: wanted } };
}


/**
 * Encrypts and writes the credential onto the target row, and does what a fresh
 * connection does (onboarding event, resend of workouts waiting for the watch).
 * Returns the public result — never anything derived from the tokens.
 */
export async function storeGarminAuth(
  req: Request,
  supabase: SupabaseClient,
  target: GarminTarget,
  auth: { email: string; tokens: Record<string, unknown> },
): Promise<{ ok: true; watchResent: number } | { ok: false }> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('athletes')
    .update({
      garmin_auth: encrypt({ ...auth, lastAuth: now }),
      garmin_authed_at: now,
      garmin_auth_failed_at: null,
    })
    .eq('id', target.athleteId);
  if (error) {
    console.error('Garmin credential save failed:', error.message);
    return { ok: false };
  }
  // Forward-only: a row already past this step ('complete', 'academy_pending')
  // keeps its status. Best-effort — the credential is what matters.
  await supabase
    .from('athletes')
    .update({ onboarding_status: 'garmin_authed' })
    .eq('id', target.athleteId)
    .or('onboarding_status.is.null,onboarding_status.in.(google_authed,strava_authed,invited)');
  await recordOnbEvent({ step: 'garmin_connected', athleteId: target.athleteId, device: deviceFromUa(req.headers.get('user-agent')) });
  const watchResent = await withinMs(sendWaitingAfterReconnect(target.athleteId), 25000, 0);
  return { ok: true, watchResent };
}
