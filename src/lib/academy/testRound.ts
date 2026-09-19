/**
 * A test round: one action that invites everybody whose numbers have gone stale.
 *
 * Section 5's `שבץ סבב`, beside `סבב טסטים כל 10 שבועות`. The registry already names the people
 * — "4 trainees have not tested in over four months, and their plans are running on old data" —
 * and until now the only way to act on that sentence was to open the invitation sheet once per
 * person. Eighteen trainees is eighteen sheets, which is how a screen that tells the truth ends
 * up being read and not acted on.
 *
 * ── A ROUND IS NOT "EVERYBODY" ────────────────────────────────────────────────────────────
 *
 * The tempting build is "invite the roster". It is wrong, and not for politeness: a threshold
 * test three weeks after the last one measures the week it was run in rather than the training
 * block, so the graph gains a point that means nothing and the plan gets re-paced off noise.
 * Worse, it spends the one thing this feature runs on — a trainee who turns up when asked. Ask
 * somebody to run 30 minutes flat out for no reason and the next ask is the one they ignore.
 *
 * So the cohort is exactly the registry's own overdue set, which includes the never-tested
 * (there is no threshold to have gone stale, which is worse than a stale one and not better).
 * The rule lives here rather than in the button so that the count the screen promises and the
 * invitations the round writes cannot come apart.
 *
 * ── AND IT NEVER TOUCHES AN OPEN INVITATION ───────────────────────────────────────────────
 *
 * Anybody already invited is skipped. The unique index in migration 112 would refuse the insert
 * anyway, but the reason is not the constraint: a round that re-offered times would overwrite a
 * Tuesday the trainee has already confirmed, and the reminders — which are computed from
 * `confirmed_slot` — would move with it. Somebody who did the right thing would lose their
 * appointment because a coach ran a round.
 *
 * That skip is also what makes a round SAFE TO RUN TWICE. Creating N invitations is N writes and
 * the fourth can fail; the honest recovery is "run it again", and it is honest only because the
 * three that succeeded now have open invitations and are therefore skipped. There is no
 * bookkeeping of round ids anywhere, and none is needed.
 *
 * ── THE CLOCK IS A PARAMETER ──────────────────────────────────────────────────────────────
 *
 * Nothing here reads it. Staleness arrives already decided, on `RegistryRow.overdue`, computed
 * against the club's own calendar day — so the round agrees with the screen above it by
 * construction instead of by a second, subtly different comparison.
 */

/** The part of a registry row a round cares about. */
export interface RoundCandidate {
  athleteId: string;
  name: string;
  /** Days since the last usable test, or null when there has never been one. */
  ageDays: number | null;
  /** The registry's own staleness verdict, never recomputed here. */
  overdue: boolean;
}

/** Why somebody is in the round. The screen prints this; a bare count sends nobody anywhere. */
export type RoundReason = 'never_tested' | 'stale';

/** Why somebody is not. Both are good news, and the screen says which. */
export type RoundSkip = 'already_invited' | 'tested_recently';

export interface RoundMember {
  athleteId: string;
  name: string;
  reason: RoundReason;
  /** Days since their last test, null for the never-tested. Used to order and to explain. */
  ageDays: number | null;
}

export interface RoundSkipped {
  athleteId: string;
  name: string;
  reason: RoundSkip;
}

export interface TestRound {
  /** Who the round invites, worst-first: never tested, then longest since a test. */
  members: RoundMember[];
  /** Who it leaves alone, and why. */
  skipped: RoundSkipped[];
}

/**
 * Who this round covers.
 *
 * `openInvitations` is the set of athlete ids with a live invitation — the board's own rows, which
 * the registry screen already holds, so the preview costs no extra request and cannot disagree
 * with the board the coach is looking at.
 */
export function buildRound(
  candidates: readonly RoundCandidate[],
  openInvitations: ReadonlySet<string>,
): TestRound {
  const members: RoundMember[] = [];
  const skipped: RoundSkipped[] = [];

  for (const c of candidates) {
    // Checked before staleness, because it is the more specific fact: somebody overdue WITH an
    // open invitation has already been asked, and reporting them as "tested recently" would be
    // false twice over.
    if (openInvitations.has(c.athleteId)) {
      skipped.push({ athleteId: c.athleteId, name: c.name, reason: 'already_invited' });
      continue;
    }
    if (!c.overdue) {
      skipped.push({ athleteId: c.athleteId, name: c.name, reason: 'tested_recently' });
      continue;
    }
    members.push({
      athleteId: c.athleteId,
      name: c.name,
      reason: c.ageDays === null ? 'never_tested' : 'stale',
      ageDays: c.ageDays,
    });
  }

  // The registry's order, for the same reason: the worst case first. Never-tested above everyone
  // (no threshold at all beats an old one), then oldest test first, then by name so a round of
  // people who all tested the same day is still in a stable, readable order.
  members.sort((a, b) => {
    const never = Number(b.ageDays === null) - Number(a.ageDays === null);
    if (never) return never;
    const age = (b.ageDays ?? 0) - (a.ageDays ?? 0);
    if (age) return age;
    return a.name.localeCompare(b.name, 'he');
  });

  return { members, skipped };
}

/**
 * What the round is about to do, in one line, naming the number.
 *
 * A confirm step that says "are you sure?" tells a coach nothing they did not already know. The
 * thing worth confirming is the COUNT and the TIME, because those are what N people receive.
 */
export function roundSummary(round: TestRound, slotCount: number): string {
  const n = round.members.length;
  if (n === 0) return 'אין למי לשבץ סבב — לכל המתאמנים יש טסט עדכני או הזמנה פתוחה.';
  // The verb agrees with the count. `מתאמן אחד יקבלו` is the sort of sentence only a template
  // writes, and it is on the screen a coach reads before sending N invitations.
  const who = n === 1 ? 'מתאמן אחד יקבל' : `${n} מתאמנים יקבלו`;
  const times = slotCount === 1 ? 'זמן אחד' : `${slotCount} זמנים`;
  return `${who} הזמנה עם ${times} לבחירה.`;
}

/** The result of writing a round: what the route managed to create, and what it did not. */
export interface RoundOutcome {
  /** Athlete ids that now have an invitation because of this round. */
  invited: string[];
  /**
   * Athletes the write refused, with the reason as the route saw it.
   *
   * Reported rather than thrown. A round is N independent invitations, and one athlete who has
   * been removed from the academy since the preview must not cost the other seventeen theirs.
   */
  failed: { athleteId: string; reason: string }[];
}
