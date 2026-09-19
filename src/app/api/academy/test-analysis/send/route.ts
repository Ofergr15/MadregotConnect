import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { COACH_ID } from '@/lib/constants';
import { isMissingColumn, isMissingTable } from '@/lib/supabase/schema-drift';
import { getStreamServerClient } from '@/lib/stream/server';
import { postAcademyTestSummary } from '@/lib/academy/thread-server';

export const dynamic = 'force-dynamic';

/**
 * `POST /api/academy/test-analysis/send` — tell the trainee what their test meant.
 *
 * The last step of funnel step 8, and the only one in this slice that leaves the building. It
 * posts the APPROVED summary into the trainee's academy thread — the same thread the weekly
 * reviews land in, because a coaching record split across two places is the WhatsApp problem
 * again with better fonts.
 *
 * ── A SEPARATE REQUEST FROM APPROVING, DELIBERATELY ───────────────────────────────────────
 *
 * Approving is a decision about numbers; sending is a message to a person. Three reasons they
 * are not one call:
 *
 *  - They fail differently. A Stream outage must not turn a signed analysis into an unsigned one.
 *  - A coach working through eight analyses must not discover afterwards that he also sent eight
 *    messages. An outward-facing write gets its own tap.
 *  - The text is usually edited between the two. Approving fixes the paces; the sentence about
 *    the person often gets one more pass.
 *
 * ── WHAT IT REFUSES ───────────────────────────────────────────────────────────────────────
 *
 * A draft (nothing has been decided yet), an empty summary (the text IS the message), and
 * anybody else's trainee. It does NOT refuse a second send: that is how a corrected sentence
 * reaches someone who already read the first one, and the message id is derived from the test so
 * the correction edits what they have rather than adding to it.
 */

/** The delivery columns land in migration 114, which is pasted by hand like every other one. */
const DELIVERY_COLUMNS = ['sent_at', 'sent_by', 'sent_summary'];

export async function POST(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!(caller.isSuperUser || caller.isStaff)) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const testId = String(body?.testId || '');
    if (!testId) return NextResponse.json({ error: 'testId is required' }, { status: 400 });

    const supabase = createServerClient();
    const isManager = caller.isSuperUser || caller.role === 'admin';

    const { data: analysis, error: readError } = await supabase
      .from('academy_test_analyses')
      .select('id, test_id, athlete_id, summary, status')
      .eq('test_id', testId)
      .maybeSingle();
    if (readError && isMissingTable(readError)) {
      return NextResponse.json({ error: 'The analyses table is not set up yet' }, { status: 503 });
    }
    // No row is not an error the coach caused — it is "you have not saved this yet", which the
    // screen can act on. Distinguished from an unapproved row below for the same reason.
    if (!analysis) return NextResponse.json({ error: 'No analysis to send', code: 'no_analysis' }, { status: 404 });

    // Scope on the ATHLETE the analysis belongs to, read here rather than trusted from the body:
    // a summary is the most personal thing on this screen, and the test id came from the client.
    const { data: athlete } = await supabase
      .from('athletes')
      .select('id, is_academy, academy_coach_id')
      .eq('id', String(analysis.athlete_id))
      .eq('coach_id', COACH_ID)
      .maybeSingle();
    if (!athlete?.is_academy) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!isManager && athlete.academy_coach_id !== caller.athleteId) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    if (analysis.status !== 'approved') {
      // The draft exists precisely so that nothing has been said yet.
      return NextResponse.json(
        { error: 'Approve the analysis before sending it', code: 'not_approved' },
        { status: 400 },
      );
    }
    const summary = String(analysis.summary || '').trim();
    if (!summary) {
      return NextResponse.json({ error: 'There is nothing to send', code: 'empty_summary' }, { status: 400 });
    }
    if (!caller.athleteId) {
      // Every message in the thread is from a person, and the seat the bubble is drawn in comes
      // from the author id. A staff caller with no athlete row has no seat to speak from.
      return NextResponse.json({ error: 'No athlete identity for the sender' }, { status: 400 });
    }

    const delivery = await postAcademyTestSummary(getStreamServerClient(), supabase, {
      athleteId: String(analysis.athlete_id),
      authorStreamId: caller.athleteId,
      testId,
      summary,
    });

    // Recorded only if it actually went. A `sent_at` written beside a failed send would tell the
    // next coach the trainee has been told — which is worse than the screen admitting it failed.
    if (!delivery.posted) {
      return NextResponse.json({ delivered: false, error: 'Delivery to the thread failed' }, { status: 502 });
    }

    const sentAt = new Date().toISOString();
    const { error: stampError } = await supabase
      .from('academy_test_analyses')
      .update({ sent_at: sentAt, sent_by: caller.athleteId, sent_summary: summary, updated_at: sentAt })
      .eq('test_id', testId);

    // The message is in the thread either way — it cannot be unsent. So a missing column (114 not
    // pasted yet) is reported as a delivery that happened but was not recorded, which is exactly
    // what it is. Saying it failed would invite a resend of something the trainee already has.
    const recorded = !stampError;
    if (stampError && !isMissingColumn(stampError) && !isMissingTable(stampError)) {
      console.error('test summary delivery stamp failed:', stampError);
    }

    return NextResponse.json({
      delivered: true,
      updated: delivery.updated,
      recorded,
      sentAt: recorded ? sentAt : null,
      ...(recorded ? {} : { unrecordedColumns: DELIVERY_COLUMNS }),
    });
  } catch {
    return NextResponse.json({ error: 'Failed to send the summary' }, { status: 500 });
  }
}
