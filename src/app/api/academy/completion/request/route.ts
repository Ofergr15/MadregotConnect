import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { israelToday } from '@/lib/utils';
import { notifyAthlete } from '@/lib/push';
import { TRAINEE_V2_FOR_ALL } from '@/lib/trainee/flag';
import { visibleTraineeIds } from '@/lib/academy/pairing-server';
import { loadCompletion } from '@/lib/academy/completion-server';
import { TEST_REQUEST_KIND, testRequestCopy, whoToAsk, type PriorRequest } from '@/lib/academy/test-request';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Sent side by side: each is a push fan-out plus an inbox row. */
const CONCURRENCY = 4;

/**
 * POST /api/academy/completion/request — "לבקש מכולם למלא בעצמם": one in-app request (and its
 * push) to every trainee in the caller's list with no usable test, asking for their last test
 * from the card on their home. Idempotent: whoever was already asked since their newest test is
 * skipped (lib/academy/test-request.ts), so a second tap sends nothing twice.
 *
 * STAFF ONLY and scoped exactly like GET /api/academy/completion — a coach asks their own
 * trainees, never the academy. The body carries nothing: who is asked is the server's answer.
 * A write, so view-as refuses it before it gets here.
 */
export async function POST(request: Request) {
  try {
    const { denied, caller } = await requireStaffCaller(request);
    if (denied) return denied;
    const supabase = createServerClient();
    const visible = await visibleTraineeIds(caller, request);
    const payload = await loadCompletion(supabase, visible, israelToday());
    if ('error' in payload) return NextResponse.json({ error: 'Failed to read the roster' }, { status: 500 });

    const ids = payload.rows.map(r => r.athleteId);
    const prior: PriorRequest[] = [];
    if (ids.length) {
      const { data, error } = await supabase
        .from('scheduled_notifications')
        .select('audience_id, last_sent_at, created_at')
        .eq('kind', TEST_REQUEST_KIND)
        .in('audience_id', ids);
      // Unreadable history must not turn the button into "ask everyone again".
      if (error) return NextResponse.json({ error: 'Failed to read earlier requests' }, { status: 500 });
      for (const r of (data || []) as any[]) {
        prior.push({ athleteId: String(r.audience_id), sentAt: String(r.last_sent_at || r.created_at || '') });
      }
    }
    const plan = whoToAsk(payload.rows, prior);

    let sender: { name: string | null; gender: string | null } = { name: null, gender: null };
    if (caller.athleteId) {
      const { data } = await supabase.from('athletes').select('name, gender').eq('id', caller.athleteId).maybeSingle();
      sender = { name: (data as any)?.name ?? null, gender: (data as any)?.gender ?? null };
    }
    // The card lives on the trainee's home: the v2 home once it is everybody's, else the academy tab.
    const url = TRAINEE_V2_FOR_ALL ? '/dashboard' : '/dashboard/academy?test=mine';

    let delivered = 0;
    const queue = [...plan.ask];
    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        const r = await notifyAthlete({
          athleteId: id,
          kind: TEST_REQUEST_KIND,
          actorAthleteId: caller.athleteId,
          url,
          tag: `${TEST_REQUEST_KIND}:${id}`,
          category: 'coach',
          copy: (locale) => testRequestCopy(locale, { coach: sender.name, coachGender: sender.gender }),
        });
        delivered += r.delivered ?? 0;
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

    return NextResponse.json({ asked: plan.ask.length, already: plan.already.length, delivered });
  } catch (err) {
    console.error('POST /api/academy/completion/request error:', err);
    return NextResponse.json({ error: 'Failed to send' }, { status: 500 });
  }
}
