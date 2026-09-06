import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { notifyAdminNewSignupRequest } from '@/lib/email';
import { groupDisplayName } from '@/lib/utils';
import { isLikelyEmail, normaliseEmail } from '@/lib/signup';

export const dynamic = 'force-dynamic';

/**
 * POST /api/public/signup — PUBLIC, unauthenticated. The shareable /register form.
 * Body: { email, groupId? }
 *
 * Answers { ok: true, state: 'member' | 'pending' | 'new' } so the form can say
 * plainly that an address is already registered — see the note on that below.
 *
 * Writes a row to `signup_requests` (migration 083) and mails the approvers. Every
 * submission is recorded, including one from somebody who already has an account —
 * that one lands as status 'member' and mails nobody (migration 089). It creates
 * NOTHING else: no auth user, no athlete row, no group membership. A
 * request is not a member until somebody approves it, and approval is what
 * creates the athlete (see /api/admin/registrations/approve).
 *
 * DELIBERATELY NOT SESSION-GATED — it runs before the person has any account at
 * all. What keeps it safe is that it can only ever insert into this one table.
 */

/**
 * Log that an existing member submitted the public form (status 'member').
 *
 * Idempotent by email: one row per address, mirroring the pending branch, because
 * a member who opens the link twice is one fact and not two. A later submission
 * with a group picked updates it — that is the only thing they can change here.
 *
 * ⚠️ Every failure is swallowed and logged. This is bookkeeping hung off a public
 * response that is already correct: the person IS a member, they need to be told so,
 * and neither a missing migration 089 (42P01 on the index / 23514 on the status
 * CHECK, if the SQL has not been pasted in yet) nor a race on the unique index is a
 * reason to hand them a 500 instead.
 */
async function recordMemberSubmission(
  supabase: ReturnType<typeof createServerClient>,
  { email, athleteId, groupId }: { email: string; athleteId: string; groupId: string | null },
): Promise<void> {
  try {
    const { data: existing } = await supabase
      .from('signup_requests')
      .select('id')
      .eq('email', email)
      .eq('status', 'member')
      .maybeSingle();

    if (existing) {
      if (groupId) await supabase.from('signup_requests').update({ group_id: groupId }).eq('id', existing.id);
      return;
    }

    const { error } = await supabase.from('signup_requests').insert({
      email,
      group_id: groupId,
      status: 'member',
      source: 'public-form',
      // The account they already have, so the admin row can point at a real person
      // rather than just an address. Filled here and NOT at approval — nothing is
      // being approved, and approved_at/approved_by stay null on purpose.
      athlete_id: athleteId,
    });
    // 23505 = unique_violation: two submissions raced on the partial index. The row
    // that won is the row we wanted.
    if (error && error.code !== '23505') throw error;
  } catch (err) {
    console.error('Failed to record an existing member’s signup submission:', err);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { email?: string; groupId?: string };
    const email = normaliseEmail(body.email || '');
    const groupId = body.groupId?.trim() || null;

    if (!isLikelyEmail(email)) {
      return NextResponse.json({ error: 'invalid-email' }, { status: 400 });
    }

    const supabase = createServerClient();

    // Validate the group rather than trusting the body: group_id is a FK, so a
    // bad id would come back as a 500 that reads like the form is broken, and an
    // id belonging to another coach's group would silently be accepted.
    let resolvedGroupId: string | null = null;
    let groupName: string | null = null;
    if (groupId) {
      const { data: group } = await supabase
        .from('groups')
        .select('id, name')
        .eq('id', groupId)
        .eq('coach_id', COACH_ID)
        .maybeSingle();
      resolvedGroupId = group?.id || null;
      groupName = group?.name ? groupDisplayName(group.name) : null;
    }

    // ── The three outcomes, and they are now told apart ──────────────────────
    //
    // This used to answer an identical { ok: true } to all three, so that the
    // endpoint could not be used as a membership check for an arbitrary address.
    // Ofer asked for the opposite twice ("אני רוצה לראות כשאני נרשם עם מייל קיים
    // — שיהיה ממש רשום שהוא כבר נרשם"): people who resubmit cannot tell whether
    // the first attempt worked, and a silent confirmation is what makes them do it.
    //
    // THE TRADE-OFF, stated because it is not visible from the call site: anyone
    // can now type an address here and learn whether it belongs to the club. That
    // was the property being protected. Accepted deliberately — one coach, ~20
    // athletes, and a link that only circulates inside the club — but it is the
    // reason to think twice before this route grows any more fields.
    //
    // `state` is advisory for the copy only. It never changes what gets written.

    // 1. Already in the queue. Update the chosen group (they may have come back to
    //    correct it) and do not mail the approvers a second time.
    //
    //    ⚠️ CHECKED BEFORE THE ATHLETE LOOKUP, and the order is the point. The
    //    pre-launch backfill (migration 090) puts every existing member in this
    //    queue as pending, so from launch week onwards a club member submitting this
    //    form matches BOTH branches. "ההרשמה שלך ממתינה לאישור" is the true and
    //    useful answer for them; "יש לך כבר חשבון, אין צורך להירשם שוב" would be
    //    literally true and actively misleading, because there IS something waiting
    //    to happen to them — the approval that mails their onboarding link.
    const { data: pending } = await supabase
      .from('signup_requests')
      .select('id')
      .eq('email', email)
      .eq('status', 'pending')
      .maybeSingle();
    if (pending) {
      if (resolvedGroupId) {
        await supabase.from('signup_requests').update({ group_id: resolvedGroupId }).eq('id', pending.id);
      }
      return NextResponse.json({ ok: true, state: 'pending' });
    }

    // 2. Already a member, and NOT in the queue. Nothing to approve — but it is
    //    still recorded, as status 'member' (migration 089).
    //
    //    This case used to write nothing at all, on the reasoning that there is
    //    nothing to queue. True of the queue, false of the record: the person was
    //    told their address is already registered and then vanished from the admin
    //    screen entirely, so the coach could not see that they had responded to the
    //    link. Ofer hit it with his own friends. NOT written as 'approved' — nobody
    //    approved anything and no athlete row was created here, so approved_by
    //    stays empty and the audit trail keeps meaning what it says.
    //
    // Matched on email ALONE, deliberately not also on coach_id. This check had
    // `.eq('coach_id', COACH_ID)` and it let real members through: 4 of the 26
    // athlete rows carry a different coach_id (legacy/seed rows), so those people
    // could re-register from the public form and land in the queue as if they were
    // strangers. `athletes.email` is UNIQUE across the whole table, so the address
    // is the identity here and a coach filter can only ever make the check miss.
    const { data: existingAthlete } = await supabase
      .from('athletes')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (existingAthlete) {
      await recordMemberSubmission(supabase, {
        email,
        athleteId: existingAthlete.id,
        groupId: resolvedGroupId,
      });
      return NextResponse.json({ ok: true, state: 'member' });
    }

    // 3. New request.
    const { error: insertError } = await supabase.from('signup_requests').insert({
      email,
      group_id: resolvedGroupId,
      status: 'pending',
      source: 'public-form',
    });

    // 23505 = unique_violation: two submissions raced on the partial unique index
    // over pending emails. Both are the same person pressing twice; the row that
    // won is the one we wanted, so this is a success, not a collision to report.
    if (insertError && insertError.code !== '23505') throw insertError;

    if (!insertError) {
      // The approvers cannot act on what they do not know arrived. Isolated: a
      // Resend outage must not fail a registration that is already committed.
      try {
        await notifyAdminNewSignupRequest({ email, groupName });
      } catch (mailErr) {
        console.error('Failed to notify approvers of a new signup request:', mailErr);
      }
    }

    return NextResponse.json({ ok: true, state: 'new' });
  } catch (err) {
    console.error('Failed to record signup request:', err);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
