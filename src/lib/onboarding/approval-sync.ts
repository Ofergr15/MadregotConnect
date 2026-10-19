import { randomBytes } from 'crypto';
import { createServerClient } from '@/lib/supabase/server';
import { notifyRegistrationApproved } from '@/lib/email';
import { ONBOARDING_V2_FOR_ALL } from '@/lib/install/flag';
import { isSyntheticAuthEmail } from '@/lib/auth/athlete-identity';
import { groupDisplayName } from '@/lib/utils';
import { recordOnbEvent } from '@/lib/onboarding/events';

/**
 * One approval, whichever door it came through (2026-10-19).
 *
 * The club had three ways to let somebody in, and only one of them finished the job:
 *  - the entry queue's request approve (/api/admin/registrations/approve): closes the
 *    request, mints the link, mails it — the complete one;
 *  - the member approve (/api/admin/approve): flipped the athlete row, closed only
 *    requests that carried its athlete_id;
 *  - the coach's "invite a runner" (POST /api/athletes): created a pre-approved row
 *    with a link the coach was meant to pass on by hand, and touched no request.
 *
 * Yoav Shachaf (10-13) went through the third seven minutes after filling in the
 * form: approved on his row, his request still "pending", no link ever sent. This is
 * the part every door now runs after its own write: close every open request that
 * is this person (by athlete_id, or by address when the request predates the row),
 * stamp who approved them, and — when they have not signed in yet — mail them the
 * personal link, the same mail the queue sends. Best-effort; never throws.
 */
export interface SyncResult {
  closedRequests: number;
  emailed: boolean;
  /** Why no mail: already signed in, no real address, or the send failed. */
  emailReason: 'signed-in' | 'no-address' | 'failed' | null;
}

export async function syncApprovedJoiner(input: {
  athleteId: string;
  approverEmail: string | null;
  /** The v2 install mail is for everyone once ONBOARDING_V2_FOR_ALL is on, and for the super user's approvals until then. */
  approverIsSuperUser: boolean;
  /** Skip the mail — the caller already sent the right one. */
  noEmail?: boolean;
}): Promise<SyncResult> {
  const out: SyncResult = { closedRequests: 0, emailed: false, emailReason: null };
  try {
    const db = createServerClient();
    const { data: a } = await db.from('athletes')
      .select('id, email, name, status, approved, approved_at, approved_by, invite_token, group_id, first_seen_at, strava_auth')
      .eq('id', input.athleteId).maybeSingle();
    const athlete = a as {
      id: string; email: string | null; name: string | null; status: string | null; approved: boolean | null;
      approved_at: string | null; approved_by: string | null; invite_token: string | null; group_id: string | null;
      first_seen_at: string | null; strava_auth: string | null;
    } | null;
    if (!athlete || athlete.approved === false) return out;
    const nowIso = new Date().toISOString();
    const email = (athlete.email || '').toLowerCase().trim();
    const realEmail = !!email && !isSyntheticAuthEmail(email);

    if (!athlete.approved_at) {
      await db.from('athletes').update({ approved_at: nowIso, approved_by: athlete.approved_by ?? input.approverEmail ?? null }).eq('id', athlete.id);
    }

    // Every open request that is this person: theirs by id, or the form they filled in by address.
    const open: Array<{ id: string }> = [];
    const byId = await db.from('signup_requests').select('id').eq('athlete_id', athlete.id).eq('status', 'pending');
    open.push(...((byId.data ?? []) as Array<{ id: string }>));
    if (realEmail) {
      const byMail = await db.from('signup_requests').select('id').eq('status', 'pending').is('athlete_id', null).ilike('email', email);
      open.push(...((byMail.data ?? []) as Array<{ id: string }>));
    }
    const ids = [...new Set(open.map((r) => r.id))];
    let token = athlete.invite_token;
    if (ids.length) {
      // Someone who has not signed in needs a link to get in; one that exists is kept,
      // so a link already passed on by hand keeps working.
      if (!token && !athlete.first_seen_at && !athlete.strava_auth) {
        token = randomBytes(16).toString('hex');
        await db.from('athletes').update({ invite_token: token }).eq('id', athlete.id);
      }
      const { error } = await db.from('signup_requests').update({
        status: 'approved', approved_at: nowIso, approved_by: input.approverEmail ?? null,
        athlete_id: athlete.id, ...(token ? { invite_token: token } : {}),
      }).in('id', ids);
      if (!error) out.closedRequests = ids.length;
      await recordOnbEvent({ step: 'approved', athleteId: athlete.id, signupRequestId: ids[0], meta: { by: input.approverEmail ?? null, sync: true } });
    }

    if (input.noEmail) return out;
    if (athlete.first_seen_at || athlete.strava_auth) { out.emailReason = 'signed-in'; return out; }
    if (!realEmail || !token) { out.emailReason = 'no-address'; return out; }
    // Mail the link only when this approval is news: a request was open, or nobody
    // has been sent one yet (the coach-invite door never sent anything).
    const { count: sentBefore } = await db.from('email_log').select('id', { count: 'exact', head: true })
      .eq('template', 'registration_approved').eq('athlete_id', athlete.id);
    if (!ids.length && (sentBefore ?? 0) > 0) return out;

    let groupName: string | null = null;
    if (athlete.group_id) {
      const { data: g } = await db.from('groups').select('name').eq('id', athlete.group_id).maybeSingle();
      groupName = (g as { name?: string } | null)?.name ? groupDisplayName((g as { name: string }).name) : null;
    }
    const mail = await notifyRegistrationApproved({
      email, token, groupName, athleteId: athlete.id, signupRequestId: ids[0] ?? null,
      v2: ONBOARDING_V2_FOR_ALL || input.approverIsSuperUser,
    });
    out.emailed = mail.ok;
    out.emailReason = mail.ok ? null : 'failed';
    return out;
  } catch (err) {
    console.error('Failed to sync an approval:', err);
    return out;
  }
}
