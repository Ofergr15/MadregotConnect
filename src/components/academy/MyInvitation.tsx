'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiHeaders } from '@/lib/api';
import { ScheduledTest } from './ScheduledTest';
import { AskOtherTimeSheet } from './AskOtherTimeSheet';
import type { TestInvitation } from '@/lib/academy/testInvite';

/**
 * The scheduled test on the trainee's real screen.
 *
 * `ScheduledTest` has existed behind a preview route since it was built: a state machine with
 * seven states, a slot picker and two reminders, reachable by nobody. The coach could create an
 * invitation (`POST /api/academy/test-invitation`) and the trainee had no screen to answer it
 * on, which made the whole feature a write with no reader.
 *
 * ── WHERE IT SITS, AND WHY THAT IS ABOVE THE GRAPH ────────────────────────────────────────
 *
 * Top of the `טסט סף` section, above the improvement chart and the entry form. The chart is
 * history and the form is for a test already run; this is the only part of that section that
 * asks the trainee for something, and the ask has a date on it. Under the chart it would be a
 * thing to scroll to, which for a once-every-few-months appointment means a thing nobody sees.
 *
 * ── SILENT WHEN THERE IS NOTHING ──────────────────────────────────────────────────────────
 *
 * No invitation, table not migrated, request failed: render nothing. Same rule `MyTest` uses,
 * and for the same reason — this sits inside somebody's weekly screen, and an error card about
 * a feature most trainees have never been part of is worse than an absence. The one thing that
 * must never happen is an empty "your test" heading over nothing, which is why the heading
 * belongs to the parent and the parent is told whether there is anything to head.
 *
 * ── THE CLOCK IS READ ONCE PER LOAD ───────────────────────────────────────────────────────
 *
 * `now` is state, not `new Date()` inline: every state boundary in `inviteState` is a
 * comparison against it, and a component that re-reads the clock on every render can show
 * `confirmed` and `overdue` in the same paint if a re-render straddles midnight.
 *
 * ── STILL MISSING, DELIBERATELY ───────────────────────────────────────────────────────────
 *
 * Recording a result does not close the invitation. The submission is pending until the coach
 * approves it, and the invitation should settle at approval time by writing
 * `academy_test_invitations.test_id` from whatever handles that approval — a server-side link,
 * not a client guess. Until then an overdue invitation stays on screen beside the trainee's own
 * `WaitingCard`, which reads correctly ("sent, nothing has changed yet") but says it twice.
 */
export function MyInvitation({
  athleteId,
  watchConnected,
  onVisible,
}: {
  athleteId: string;
  /** Whether a watch is linked — changes what the trainee has to do after the run. */
  watchConnected?: boolean;
  /** Tells the parent whether anything rendered, so it can drop text this screen replaces. */
  onVisible?: (visible: boolean) => void;
}) {
  const [invitation, setInvitation] = useState<TestInvitation | null>(null);
  const [now, setNow] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/academy/test-invitation?athleteId=${encodeURIComponent(athleteId)}`,
        { headers: await apiHeaders() },
      );
      const data = await res.json().catch(() => ({}));
      setInvitation(res.ok && data?.invitation ? (data.invitation as TestInvitation) : null);
      setNow(new Date().toISOString());
    } catch {
      setInvitation(null);
    }
  }, [athleteId]);

  useEffect(() => { void load(); }, [load]);

  const answer = useCallback(async (body: Record<string, unknown>) => {
    if (!invitation) return;
    setBusy(true);
    try {
      const res = await fetch('/api/academy/test-invitation', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await apiHeaders()) },
        body: JSON.stringify({ id: invitation.id, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      // Re-read from the response rather than patching local state optimistically: the route
      // refuses a slot that was never offered and one that has just gone by, and a screen that
      // says `מאושר` after a 400 is a trainee who believes they have an appointment.
      if (res.ok && data?.invitation) {
        setInvitation(data.invitation as TestInvitation);
        setNow(new Date().toISOString());
      } else {
        await load();
      }
    } catch {
      await load();
    } finally {
      setBusy(false);
      setAsking(false);
    }
  }, [invitation, load]);

  const visible = !!invitation && !!now;
  useEffect(() => { onVisible?.(visible); }, [visible, onVisible]);

  if (!invitation || !now) return null;

  return (
    <>
      <ScheduledTest
        invitation={invitation}
        now={now}
        watchConnected={watchConnected}
        busy={busy}
        onConfirm={slot => { void answer({ action: 'confirm', slot }); }}
        onAskOther={() => setAsking(true)}
      />
      <AskOtherTimeSheet
        open={asking}
        onOpenChange={setAsking}
        busy={busy}
        onSend={note => { void answer({ action: 'other', note }); }}
      />
    </>
  );
}
