'use client';

import { useEffect, useState } from 'react';
import { apiHeaders } from '@/lib/api';
import { activityLocalDateStr } from '@/lib/utils';
import { FeedbackCard, type TraineeFeedback } from './FeedbackCard';

/**
 * The mentor's feedback on one run, wherever that run is opened.
 *
 * Mounted inside ActivityDetailBody, directly under the accuracy ring, which is
 * the whole point of the placement: the ring says 62% and this says what a person
 * made of it. Those two disagreeing — or the second one being absent for a week —
 * is the thing the academy is trying to stop happening.
 *
 * Renders NOTHING at all when there is no feedback. Not an empty state: most runs
 * in the club are not academy sessions and never will be reviewed, and a "your
 * mentor hasn't written yet" box under every parkrun would be a promise the app
 * did not make. The card's own empty branch is for a surface that already knows
 * the trainee is in the academy.
 *
 * It fetches its own row rather than taking one as a prop. That costs one indexed
 * lookup per detail open, including for the non-academy majority, and the
 * alternative was threading an is-academy flag plus a feedback row through both
 * the feed's expanded card and the standalone activity page — two call sites that
 * currently need to know nothing about the academy at all.
 */
export function RunFeedback({
  athleteId,
  startTime,
  className,
}: {
  athleteId: string | null | undefined;
  /** The run's start — the athlete-local DAY of it is the key the mentor wrote against. */
  startTime: string | null | undefined;
  className?: string;
}) {
  const [fb, setFb] = useState<TraineeFeedback | null>(null);

  useEffect(() => {
    if (!athleteId || !startTime) return;
    let cancelled = false;
    (async () => {
      try {
        const date = activityLocalDateStr(startTime);
        const res = await fetch(
          `/api/academy/feedback?athleteId=${encodeURIComponent(athleteId)}&date=${date}`,
          { headers: await apiHeaders() },
        );
        // A 403 is the expected answer for someone reading another member's run, and
        // a 404-shaped empty body is the expected answer for a run nobody reviewed.
        // Neither is an error worth showing: the card simply is not there.
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data?.feedback) setFb(data.feedback as TraineeFeedback);
      } catch {
        /* Silent on purpose — see above. */
      }
    })();
    return () => { cancelled = true; };
  }, [athleteId, startTime]);

  if (!fb) return null;
  // No `segments` passed: a lap comment is then titled "חזרה 4" from the planned
  // step index instead of "חזרה 4 (1 ק״מ)". Same step, same number — only the
  // length suffix is lost, and re-fetching a whole segment grading to print a
  // parenthesis is not worth a second request on every run.
  return <FeedbackCard feedback={fb} className={className} />;
}
