// ═════════════════════════════════════════════════════════════════════════════
// WHEN THE "WHAT'S NEW" SHEET IS ALLOWED TO OPEN
//
// The research on this surface is unusually blunt, so the rules are too.
//
//   1. NEVER TO SOMEONE NEW. An entry published before this device first opened
//      the app is not news — it is the app. Somebody who joined last week does
//      not get told about a feature that was already there when they arrived.
//      This is what `since` is for, and it is why a brand-new device sees
//      nothing at all on its first visit: `since` is stamped today, and nothing
//      published today-or-earlier qualifies.
//   2. ONCE PER ENTRY, EVER. The ledger stores slugs, not a version or a date,
//      so shipping a fourth feature cannot re-announce the first three.
//   3. CLOSING IT IS FINAL — and safe to offer only because the profile keeps a
//      permanent "מה חדש" row. Dismissible AND recallable is one rule, not two:
//      NN/g's Evernote case is a sidebar entry that survives the X. Reopening
//      from there shows the same entries and does not mark them seen.
//   4. AT MOST THREE ROWS. Past three the sheet is a newsletter. The newest win.
//   5. NOT ON A COLD PAINT. The caller opens it on a LOADED feed, never on the
//      skeleton — a modal over a page the reader has not seen yet erases the
//      context that made it meaningful.
//
// Pure and clock-free (`today` is passed in), so all of it is testable without a
// browser: src/__tests__/whatsNewLedger.test.ts. Storage is localStorage, i.e.
// per device — the same choice the setup nudge made, for the same reason.
// ═════════════════════════════════════════════════════════════════════════════

import type { WhatsNewEntry } from './entries';

export const WHATS_NEW_KEY = 'mc:whatsNew';

/** Rule 4. */
export const WHATS_NEW_MAX_ROWS = 3;

/**
 * Stamped as `since` for a device that was clearly using the app before this
 * module existed, so the first release of it does announce itself. A real date
 * in the past rather than null, because null would have to mean two different
 * things (never initialised / everything is news).
 */
export const WHATS_NEW_EPOCH = '2000-01-01';

/**
 * localStorage keys the app only ever writes during normal use. Their presence
 * is the one honest signal available client-side that this device is not opening
 * MadregotConnect for the first time — cheaper and more reliable than asking the
 * server for an account age, which would also be the wrong question (the account
 * can be a year old on a phone that just installed the app).
 */
export const RETURNING_DEVICE_KEYS = ['view_group', 'athlete_name'];
export const RETURNING_DEVICE_PREFIXES = ['setup_nudge:', 'mc:weekSummaryDismissed:'];

export interface WhatsNewLedger {
  /** Slugs already shown in an auto-opened sheet. */
  seen: string[];
  /** `YYYY-MM-DD` this device first reached the feed, or null before rule 1 runs. */
  since: string | null;
}

/** Anything unparseable reads as fresh: the cost is one extra sheet, where
 *  throwing would break the feed for a broken string. */
export function readWhatsNewLedger(raw: string | null | undefined): WhatsNewLedger {
  if (!raw) return { seen: [], since: null };
  try {
    const parsed = JSON.parse(raw) as Partial<WhatsNewLedger>;
    return {
      seen: Array.isArray(parsed.seen) ? parsed.seen.filter((s) => typeof s === 'string') : [],
      since: typeof parsed.since === 'string' ? parsed.since : null,
    };
  } catch {
    return { seen: [], since: null };
  }
}

export function deviceIsReturning(keys: string[]): boolean {
  return keys.some((k) => (
    RETURNING_DEVICE_KEYS.includes(k) || RETURNING_DEVICE_PREFIXES.some((p) => k.startsWith(p))
  ));
}

/**
 * Rule 1, once per device. A ledger that already has a `since` is left exactly
 * as it is — re-stamping it on every visit would silently make every entry old.
 */
export function initLedger(
  ledger: WhatsNewLedger, today: string, returning: boolean,
): WhatsNewLedger {
  if (ledger.since) return ledger;
  return { ...ledger, since: returning ? WHATS_NEW_EPOCH : today };
}

/** Newest first, capped. Sorting here rather than trusting the file's order. */
export function recentEntries(entries: WhatsNewEntry[]): WhatsNewEntry[] {
  return [...entries]
    .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0))
    .slice(0, WHATS_NEW_MAX_ROWS);
}

/**
 * What the sheet shows when it is reopened from the profile: the recent entries,
 * seen or not. Rule 3 — a recallable list that hid everything you had read would
 * be an empty screen for the people most likely to look.
 */
export function visibleEntries(
  entries: WhatsNewEntry[], ledger: WhatsNewLedger,
): WhatsNewEntry[] {
  const since = ledger.since ?? WHATS_NEW_EPOCH;
  return recentEntries(entries.filter((e) => e.publishedAt > since));
}

/** What justifies opening the sheet by itself: rules 1, 2 and 4 together. */
export function unseenEntries(
  entries: WhatsNewEntry[], ledger: WhatsNewLedger,
): WhatsNewEntry[] {
  return visibleEntries(entries, ledger).filter((e) => !ledger.seen.includes(e.slug));
}

/** Rule 2. Spend these slugs; they never come back on their own. */
export function markSeen(ledger: WhatsNewLedger, slugs: string[]): WhatsNewLedger {
  const seen = new Set(ledger.seen);
  for (const s of slugs) seen.add(s);
  return { ...ledger, seen: [...seen] };
}
