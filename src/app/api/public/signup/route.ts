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
 * Writes a row to `signup_requests` (migration 083) and mails the approvers. It
 * creates NOTHING else: no auth user, no athlete row, no group membership. A
 * request is not a member until somebody approves it, and approval is what
 * creates the athlete (see /api/admin/registrations/approve).
 *
 * DELIBERATELY NOT SESSION-GATED — it runs before the person has any account at
 * all. What keeps it safe is that it can only ever insert into this one table,
 * and the response is identical whatever the address turns out to be (below).
 */

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

    // ── The three outcomes, all of which answer the same thing to the caller ──
    //
    // A public form must not be an oracle over who is in the club. "You are
    // already a member" and "you already applied" and "you are new" are three
    // different sentences, and any of them told apart from the others turns this
    // endpoint into a membership check for an arbitrary address. So each path
    // returns { ok: true } and the form says the same thing.

    // 1. Already a member (an athlete row exists). Nothing to queue.
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
      return NextResponse.json({ ok: true });
    }

    // 2. Already pending. Update the chosen group (they may have come back to
    //    correct it) and do not mail the approvers a second time.
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
      return NextResponse.json({ ok: true });
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

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Failed to record signup request:', err);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
