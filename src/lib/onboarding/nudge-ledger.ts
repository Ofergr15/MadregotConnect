// ═════════════════════════════════════════════════════════════════════════════
// HOW OFTEN THE IN-FEED SETUP NUDGE IS ALLOWED TO APPEAR
//
// The card sits at the top of the feed — the one screen every member does open —
// so the whole question is restraint. A reminder that shows up on every single
// open is not a reminder, it is the feed's new header, and the member learns to
// scroll past it (which also teaches them to scroll past whatever we put there
// next).
//
// The rules, in the order they bind:
//
//   1. ONLY WHILE SOMETHING IS MISSING. Enforced by the caller off
//      `computeSetupState` — `allDone` or `completed` means the card is gone.
//   2. NEVER DURING THE FIRST RUN. The tour is already explaining this; two
//      voices saying "finish your profile" at once is one too many. The caller
//      gates on `tourSeen`.
//   3. ONCE A DAY, AT MOST. A day that already showed it stays "shown" for the
//      rest of that day, so a reload or a feed ↔ profile hop cannot spend a
//      second appearance.
//   4. THREE DAYS, EVER. After the third distinct day the card never comes back
//      on this device — the header pill carries the nag from then on, which is
//      quiet and permanent instead of loud and repeated.
//   5. דלג IS FOREVER. A labelled skip that reappears tomorrow is a lie, and
//      the reason it is safe to offer at all is that the pill does NOT go with
//      it. See SetupPill.
//
// Pure and clock-free (`now` is passed in) so all five are testable without a
// browser — src/__tests__/setupNudgeLedger.test.ts. The store is localStorage,
// i.e. per DEVICE: dismissing the card on a phone says nothing about a laptop,
// which is the same rule the install offer already lives by (being installed is
// a property of a device, not of a person).
// ═════════════════════════════════════════════════════════════════════════════

/** How many distinct days may ever show the card. */
export const NUDGE_MAX_DAYS = 3;

export interface NudgeLedger {
  /** The distinct local days the card has been shown on, as `YYYY-MM-DD`. */
  days: string[];
  /** They pressed דלג. Terminal. */
  skipped: boolean;
}

/**
 * Per-athlete, because one device does get handed around: a parent opening the
 * app on their own phone to check a child's run should not inherit somebody
 * else's dismissal, and the super user's "view as" must not spend a real
 * member's three days.
 */
export function nudgeLedgerKey(athleteId: string): string {
  return `setup_nudge:${athleteId}`;
}

/** Local calendar day. Deliberately NOT UTC: "once a day" means the member's day,
 *  and a UTC boundary would let a 02:00 open in Israel count as yesterday. */
export function nudgeDayKey(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Anything unparseable reads as a fresh ledger — the worst case is one extra
 *  appearance, where throwing would hide the card behind a broken string. */
export function readNudgeLedger(raw: string | null | undefined): NudgeLedger {
  if (!raw) return { days: [], skipped: false };
  try {
    const parsed = JSON.parse(raw) as Partial<NudgeLedger>;
    return {
      days: Array.isArray(parsed.days) ? parsed.days.filter((d) => typeof d === 'string') : [],
      skipped: parsed.skipped === true,
    };
  } catch {
    return { days: [], skipped: false };
  }
}

/** Rules 3, 4 and 5. */
export function nudgeAllowed(ledger: NudgeLedger, today: string): boolean {
  if (ledger.skipped) return false;
  // Already counted today → keep showing it for the rest of today. Rule 3 caps
  // the number of DAYS, not the number of renders: a card that vanished on the
  // second render of the same day would look like a bug.
  if (ledger.days.includes(today)) return true;
  return ledger.days.length < NUDGE_MAX_DAYS;
}

/** Spend today, if today isn't spent already. */
export function recordNudgeShown(ledger: NudgeLedger, today: string): NudgeLedger {
  if (ledger.days.includes(today)) return ledger;
  return { ...ledger, days: [...ledger.days, today] };
}

export function skipNudge(ledger: NudgeLedger): NudgeLedger {
  return { ...ledger, skipped: true };
}
