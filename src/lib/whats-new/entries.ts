// ═════════════════════════════════════════════════════════════════════════════
// WHAT'S NEW — THE CURATED LIST
//
// Hand-written, in this file, and deliberately NOT a changelog: 2.40.x ships
// most days, and a module that announced every version would spend the one
// interruption the app gets on "fixed a rounding bug". An entry earns its place
// only if it changes what a member can DO. Three rows is the ceiling the sheet
// draws; the newest three win.
//
// Text lives here in both languages rather than in messages/*.json, the same
// call as WEEK_CARD_TEXT in lib/reports/week-share.ts: an entry is one object
// that gets added and later deleted, and splitting its four strings across two
// catalogues (plus a parity test) to say one thing once is more ceremony than
// the content is worth. Typed by language, so an entry that forgets English is
// a compile error.
//
// `publishedAt` is load-bearing, not decoration — see ledger.ts. An entry
// published before this device first opened the app is not news to whoever is
// holding it, and never appears. That is what keeps the sheet away from someone
// who signed up yesterday.
// ═════════════════════════════════════════════════════════════════════════════

/** Which drawn screen illustrates the row. See components/whats-new/WhatsNewArt. */
export type WhatsNewArt = 'weekShare' | 'nextSession' | 'planVsExecution';

export interface WhatsNewCopy {
  title: string;
  /** One sentence: what you can do, and where. Two lines on a phone, at most. */
  body: string;
  /** A headline card's button. Only the entries that carry `cards` have one. */
  cta?: string;
  /** The tour's small line over the title, and its "where you will find it" under the body. Headlines only. */
  kicker?: string;
  where?: string;
}

/**
 * One frame of a headline card's art: a real render of that view, drawn by the
 * app's own card renderer into `public/whats-new/<key>.<lang>.jpg`, with the
 * view's name under it.
 */
export interface WhatsNewCardFrame {
  key: string;
  he: string;
  en: string;
}

/**
 * One tap of a headline's editing demo: the finger goes to (x, y), in points of
 * the 390x844 screen the editor was captured on, and after the tap the screen
 * becomes `public/whats-new/edit/<key>.jpg`. `part` lights up the part of the
 * card being edited.
 */
export interface WhatsNewDemoStep {
  key: string;
  x: number;
  y: number;
  part?: 'numbers' | 'logo' | 'text' | 'background';
  he: string;
  en: string;
}

/** The tour page after a headline that shows its editor at work, on real captures of it. */
export interface WhatsNewDemo {
  /** The screen before the first tap. */
  first: string;
  steps: WhatsNewDemoStep[];
  he: WhatsNewCopy;
  en: WhatsNewCopy;
}

export interface WhatsNewEntry {
  /** Stable forever — it is the key the "seen" ledger stores. Never reuse one. */
  slug: string;
  /** `YYYY-MM-DD`, the day it reached prod. */
  publishedAt: string;
  /** The drawn thumbnail. A release note has none and shows `icon` instead. */
  art?: WhatsNewArt;
  /**
   * A HEADLINE instead of a row: a bordered card whose art cycles through these
   * frames, with a button (`cta`) that goes to `href`. See lib/whats-new/evening.ts.
   */
  cards?: WhatsNewCardFrame[];
  /** The tour's editing page after this headline (components/whats-new/WhatsNewStory). */
  demo?: WhatsNewDemo;
  /** An emoji tile, for the entries the daily release adds (lib/release-notes.ts). */
  icon?: string;
  /**
   * Where the row goes — and it must be a REAL route, i.e. a directory under
   * `src/app/(app)/`. `/program` was written here first and there is no such
   * page (it is `/dashboard/program`), which is half of why the rows looked dead
   * in 2.40.91. The test asserts every href resolves to a page on disk.
   *
   * Point it at a page that SHOWS the feature, not at the page the reader is
   * already on: both of these features live on the feed, and sending somebody
   * from the feed back to the feed is indistinguishable from a broken row.
   */
  href: string;
  he: WhatsNewCopy;
  en: WhatsNewCopy;
}

/** Newest first is not required — the sheet sorts by `publishedAt`. */
export const WHATS_NEW: WhatsNewEntry[] = [
  {
    slug: 'week-share-2026-09',
    publishedAt: '2026-09-18',
    art: 'weekShare',
    href: '/dashboard/profile',
    he: {
      title: 'הסיכום השבועי — עכשיו לשיתוף',
      body: 'הכרטיס של השבוע שלך, מוכן לסטורי. בוחרים אילו נתונים ייכנסו, מוסיפים תמונה, ושולחים.',
    },
    en: {
      title: 'Share your weekly summary',
      body: 'Your week as a story card. Pick which numbers go on it, add a photo, send.',
    },
  },
  {
    slug: 'next-session-feed-2026-09',
    publishedAt: '2026-09-19',
    art: 'nextSession',
    href: '/dashboard/program',
    he: {
      title: 'האימון של מחר, בפיד',
      body: 'מה יש מחר, כמה ק״מ, ואם זה כבר נמצא בשעון. לחיצה פותחת את האימון המלא.',
    },
    en: {
      title: "Tomorrow's session, on the feed",
      body: "What's next, how far, and whether your watch already has it. Tap for the full session.",
    },
  },
];

export const WHATS_NEW_LANGS = ['he', 'en'] as const;
export type WhatsNewLang = (typeof WHATS_NEW_LANGS)[number];

export function entryCopy(entry: WhatsNewEntry, lang: WhatsNewLang): WhatsNewCopy {
  return entry[lang];
}
