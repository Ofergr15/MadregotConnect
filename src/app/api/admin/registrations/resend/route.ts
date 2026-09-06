import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { createServerClient } from '@/lib/supabase/server';
import { APP_URL, canApprove } from '@/lib/constants';
import { authError, requireSession } from '@/lib/auth-session';
import { isEmailConfigured, notifyRegistrationApproved } from '@/lib/email';
import { groupDisplayName } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/registrations/resend — send an already-approved applicant their
 * join link again.
 *
 * The gap this closes: approval mails the link exactly once, and if that send
 * fails (or lands in spam, or the address had a typo) the person is approved,
 * waiting, and unreachable from every screen in the app. The link was only
 * recoverable from the database. This is the same mail, to the same address, for a
 * request that is ALREADY approved — it grants nothing that the approval didn't.
 *
 * Same gate as approve: a verified session AND canApprove. It is a mutation
 * (it can re-mint the token) and it emails a credential, so it is not open to
 * members. Note it deliberately cannot approve anything — a non-approved request
 * is a 400, not a shortcut.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireSession(request);
    if (!auth.ok) return authError(auth);
    if (!canApprove(auth.user.email)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const { id } = (await request.json().catch(() => ({}))) as { id?: string };
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const supabase = createServerClient();

    const { data: reqRow, error: findError } = await supabase
      .from('signup_requests')
      .select('id, email, status, group_id, invite_token, athlete_id')
      .eq('id', id)
      .maybeSingle();
    if (findError) throw findError;
    if (!reqRow) return NextResponse.json({ error: 'Registration not found' }, { status: 404 });
    if (reqRow.status !== 'approved') {
      return NextResponse.json({ error: 'not-approved' }, { status: 400 });
    }

    // A row approved before the token was stamped on the request has none, and a
    // link cannot be conjured from nothing — so mint one and put it on BOTH rows.
    // The athlete row is what /join/{token} actually looks the token up on; a token
    // that only exists on the request would 404 on the join page.
    let token = reqRow.invite_token as string | null;
    if (!token) {
      token = randomBytes(16).toString('hex');
      const target = reqRow.athlete_id
        ? supabase.from('athletes').update({ invite_token: token }).eq('id', reqRow.athlete_id)
        : supabase.from('athletes').update({ invite_token: token }).eq('email', reqRow.email);
      const { error: stampError } = await target;
      if (stampError) throw stampError;
      await supabase.from('signup_requests').update({ invite_token: token }).eq('id', id);
    }

    let groupName: string | null = null;
    if (reqRow.group_id) {
      const { data: group } = await supabase.from('groups').select('name').eq('id', reqRow.group_id).maybeSingle();
      groupName = group?.name ? groupDisplayName(group.name) : null;
    }

    if (!isEmailConfigured()) {
      // Not an error the caller can fix by retrying, and the link is the useful
      // half of the answer anyway.
      return NextResponse.json({
        ok: true,
        emailed: false,
        emailReason: 'email-not-configured',
        joinUrl: `${APP_URL}/join/${token}`,
      });
    }

    try {
      await notifyRegistrationApproved({ email: reqRow.email, token, groupName });
    } catch (mailErr) {
      console.error('Re-send of an approval link failed:', mailErr);
      return NextResponse.json({
        ok: true,
        emailed: false,
        emailReason: mailErr instanceof Error ? mailErr.message : 'send failed',
        joinUrl: `${APP_URL}/join/${token}`,
      });
    }

    return NextResponse.json({ ok: true, emailed: true, joinUrl: `${APP_URL}/join/${token}` });
  } catch (err) {
    console.error('Failed to resend an approval link:', err);
    return NextResponse.json({ error: 'Failed to resend' }, { status: 500 });
  }
}
