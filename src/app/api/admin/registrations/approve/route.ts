import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { createServerClient } from '@/lib/supabase/server';
import { APP_URL, canApprove, COACH_ID } from '@/lib/constants';
import { authError, requireSession } from '@/lib/auth-session';
import { isEmailConfigured, notifyRegistrationApproved } from '@/lib/email';
import { groupDisplayName } from '@/lib/utils';
import { placeholderNameFromEmail } from '@/lib/signup';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/registrations/approve
 * Body: { id, action?: 'approve' | 'reject', groupId?: string | null }
 *
 * Approving a signup_request (migration 083) is the moment the applicant becomes
 * an athlete: it creates the row, mints an invite token, and mails them the
 * /join/{token} link that asks for their name and watch. Rejecting only stamps
 * the request — no athlete row is created and no mail is sent, because "you were
 * turned down" is a conversation the coach has, not an automated email.
 *
 * `groupId` lets the approver set or correct the group in the same action as
 * approving, and it is REQUIRED: approving without a resolvable group is a 400
 * (`group-required` / `group-invalid`). See the check below for why.
 *
 * This does NOT reuse /api/admin/approve: that route flips `approved` on an
 * existing athlete row, and here there isn't one yet. The two must stay in step
 * on what approval implies (approved / approved_at / approved_by / status).
 */
export async function POST(request: Request) {
  try {
    const auth = await requireSession(request);
    if (!auth.ok) return authError(auth);

    // Authoritative gate. The UI also hides the buttons, but that is cosmetic.
    const approverEmail = auth.user.email;
    if (!canApprove(approverEmail)) {
      return NextResponse.json({ error: 'You are not authorized to approve registrations.' }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      id?: string;
      action?: 'approve' | 'reject';
      groupId?: string | null;
    };
    const { id } = body;
    const action = body.action || 'approve';
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const supabase = createServerClient();

    const { data: reqRow, error: findError } = await supabase
      .from('signup_requests')
      .select('id, email, group_id, status')
      .eq('id', id)
      .maybeSingle();
    if (findError) throw findError;
    if (!reqRow) return NextResponse.json({ error: 'Registration not found' }, { status: 404 });

    // Idempotent: two approvers on their phones at once, or a double-tap, must
    // not create a second athlete row or send a second link.
    if (reqRow.status !== 'pending') {
      return NextResponse.json({ ok: true, alreadyHandled: reqRow.status });
    }

    if (action === 'reject') {
      const { error } = await supabase
        .from('signup_requests')
        .update({ status: 'rejected', rejected_at: new Date().toISOString(), rejected_by: approverEmail || null })
        .eq('id', id)
        .eq('status', 'pending');
      if (error) throw error;
      return NextResponse.json({ ok: true, status: 'rejected' });
    }

    // The approver's correction wins over what the applicant picked. `undefined`
    // means "leave as submitted", which is why this tests for the key rather than
    // for truthiness.
    const requestedGroupId = 'groupId' in body ? body.groupId ?? null : reqRow.group_id;

    // ── A GROUP IS MANDATORY TO APPROVE ──────────────────────────────────────
    //
    // Most applicants pick "לא בטוח/ה" and arrive with group_id NULL, so this is
    // the common case, not an edge one. Approving without a group used to be
    // allowed and it produced a member who belongs to nothing: no band pace, no
    // group plan, invisible in every group-scoped screen — and nothing anywhere
    // that says they need fixing, because from the queue's point of view they were
    // handled. Assigning the group has to happen at the approval, so the gate is
    // here rather than only in the UI.
    if (!requestedGroupId) {
      return NextResponse.json(
        { error: 'group-required', message: 'צריך לשייך דבוקה לפני אישור.' },
        { status: 400 },
      );
    }

    const { data: group } = await supabase
      .from('groups')
      .select('id, name')
      .eq('id', requestedGroupId)
      .eq('coach_id', COACH_ID)
      .maybeSingle();

    // A group id that does not resolve — a stale id, or one belonging to another
    // coach — is a failure, NOT a fallback to "no group". This used to silently
    // null it out and approve anyway, which is the same broken member as above but
    // arrived at while the caller believed it had set a group.
    if (!group) {
      return NextResponse.json(
        { error: 'group-invalid', message: 'הדבוקה שנבחרה לא נמצאה.' },
        { status: 400 },
      );
    }

    const groupId: string = group.id;
    const groupName: string | null = group.name ? groupDisplayName(group.name) : null;

    const token = randomBytes(16).toString('hex');
    const nowIso = new Date().toISOString();

    // status stays 'invited', NOT 'active': they have not finished registering.
    // /api/athletes/connect flips it to active when they complete /join/{token},
    // and it only does that because `approved` is true here.
    const insertPayload: Record<string, unknown> = {
      coach_id: COACH_ID,
      // See placeholderNameFromEmail(): the form never asks for a name, and
      // /join/{token} overwrites this with the real one in the next step.
      name: placeholderNameFromEmail(reqRow.email),
      email: reqRow.email,
      status: 'invited',
      invite_token: token,
      approved: true,
      approved_at: nowIso,
      approved_by: approverEmail || null,
      group_id: groupId,
    };

    const { data: athlete, error: insertError } = await supabase
      .from('athletes')
      .insert(insertPayload)
      .select('id')
      .single();

    // 23505 = unique_violation on athletes.email (migration 079). Someone signed
    // up through another door — a Google/Strava login, or the academy form —
    // between registering here and being approved. Adopt that row rather than
    // failing: mark it approved, give it the token, and mail the link. The
    // request is still legitimately approved; there is just already a row for it.
    let athleteId = athlete?.id as string | undefined;
    if (insertError) {
      if (insertError.code !== '23505') throw insertError;
      const { data: existing } = await supabase
        .from('athletes')
        .select('id')
        .eq('email', reqRow.email)
        .maybeSingle();
      if (!existing) throw insertError;
      athleteId = existing.id;
      await supabase
        .from('athletes')
        .update({
          approved: true,
          approved_at: nowIso,
          approved_by: approverEmail || null,
          invite_token: token,
          group_id: groupId,
        })
        .eq('id', existing.id);
    }

    // Only now is the request closed — if the athlete write had failed, the
    // request must stay pending so it can be tried again.
    const { error: markError } = await supabase
      .from('signup_requests')
      .update({
        status: 'approved',
        approved_at: nowIso,
        approved_by: approverEmail || null,
        athlete_id: athleteId || null,
        invite_token: token,
        group_id: groupId,
      })
      .eq('id', id)
      .eq('status', 'pending');
    if (markError) throw markError;

    // Isolated: the approval is already committed, and a Resend outage must not
    // undo it or make the queue look like nothing happened. If this fails, the
    // link is still on the row and can be re-sent (or copied out of the queue).
    //
    // `emailed` used to be a guess dressed as a fact. It was true unless something
    // threw, and nothing threw: an unconfigured key returns quietly, and Resend's
    // SDK resolves with { error } instead of throwing. So the queue reported a
    // link delivered to somebody who never got one. Both holes are closed now —
    // this asks first, and notifyRegistrationApproved throws on a refusal — and
    // `emailReason` carries the refusal out to the screen, because "Resend won't
    // send to that address from this sender" is not a thing anyone can guess.
    let emailed = isEmailConfigured();
    let emailReason: string | null = emailed ? null : 'email-not-configured';
    if (emailed) {
      try {
        await notifyRegistrationApproved({ email: reqRow.email, token, groupName });
      } catch (mailErr) {
        emailed = false;
        emailReason = mailErr instanceof Error ? mailErr.message : 'send failed';
        console.error('Approval email failed for a signup request:', mailErr);
      }
    }

    // The link rides back regardless of the mail. It is the only thing the
    // approver can act on when delivery fails, and going to look it up means a
    // trip to the SQL editor.
    return NextResponse.json({
      ok: true,
      status: 'approved',
      athleteId,
      emailed,
      emailReason,
      inviteToken: token,
      joinUrl: `${APP_URL}/join/${token}`,
    });
  } catch (err) {
    console.error('Failed to approve registration:', err);
    return NextResponse.json({ error: 'Failed to approve registration' }, { status: 500 });
  }
}
