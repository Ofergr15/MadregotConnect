// ═════════════════════════════════════════════════════════════════════════════
// THE EVENING RELEASE — the two share editors, for everyone, with a What's new
//
// The approved mockup is version A (the full-screen tour) of ~/.cache/madregot/mockups/whats-new-showcase.html:
// a page for each headline (the workout share card, then the weekly summary),
// its art cycling through the real views and a button that opens the editor on
// the reader's own run or week, then a page that shows that editor at work (a
// finger tapping through real captures of it: tour-v2.html), and a last page with everything else that
// shipped since the last What's new. Settings keeps version B's sheet, with a
// way to watch the tour again.
//
// ONE SWITCH. Until `EVENING_OPEN` is true, everything here is the super user's
// only: the two editors (ShareSheet), the week-before comparison on the weekend
// card, and these entries in the settings row and the release rehearsal. The
// feed's auto-open never shows them to anyone before the switch, the super user
// included, so his own "once per device" is still unspent when the real one
// comes and he sees tonight exactly as a member does.
// ═════════════════════════════════════════════════════════════════════════════

import { compareAppVersions } from '@/lib/feedback/lifecycle';
import { releaseEntries, type ShownNote, type WhatsNewRelease } from '@/lib/release-notes';
import type { WhatsNewEntry } from './entries';
import { WHATS_NEW } from './entries';

/** Flipped on his go, and that commit is the release. */
export const EVENING_OPEN = false;

/** The hook that reads the switch is lib/use-evening-release.ts, kept out of here so node tests need no React. */

/** The day after the last hand-written entry (next-session-feed, 09-19): the "more" list starts here. */
export const EVENING_SINCE = '2026-09-20';

/**
 * Notes the two headlines already say. Listing them again under the cards would
 * announce the share card three times, and several of them fix a sheet members
 * never used, because the editor replaces it.
 */
export const EVENING_FOLDED: readonly string[] = [
  'share-six-views', 'share-logo-segments-tabs', 'share-km-splits-en', 'share-splits-every-km',
  'share-splits-from-laps', 'share-segments-scale', 'share-card-name-language', 'share-sheet-english-and-taps',
  'week-share-logo-place', 'week-sleep-resting-hr',
];

export const EVENING_ENTRIES: WhatsNewEntry[] = [
  {
    slug: 'share-editor-2026-09',
    publishedAt: '2026-09-30',
    href: '/dashboard/share?what=run',
    cards: [
      { key: 'share-splits', he: 'ק״מ אחרי ק״מ', en: 'KM Splits' },
      { key: 'share-route', he: 'מסלול', en: 'Route' },
      { key: 'share-statsBar', he: 'שורת נתונים', en: 'Stats bar' },
      { key: 'share-classic', he: 'קלאסי', en: 'Classic' },
      { key: 'share-card', he: 'כרטיס', en: 'Card' },
      { key: 'share-minimal', he: 'מינימלי', en: 'Minimal' },
    ],
    demo: {
      first: 'run-00clean',
      steps: [
      { key: 'run-01edit', x: 55, y: 28, he: 'לוחצים "עריכה"', en: 'Tap "Edit"' },
      { key: 'run-02numbers', x: 281, y: 167, part: 'numbers', he: 'נוגעים במספרים שבכרטיס', en: 'Tap the numbers on the card' },
      { key: 'run-03a-offtime', x: 240, y: 666, part: 'numbers', he: 'מורידים את הזמן…', en: 'Take the time off…' },
      { key: 'run-03hr', x: 149, y: 716, part: 'numbers', he: '…ומכניסים דופק', en: '…and put heart rate on' },
      { key: 'run-04logo', x: 271, y: 373, part: 'logo', he: 'נוגעים בלוגו', en: 'Tap the logo' },
      { key: 'run-05badge', x: 317, y: 620, part: 'logo', he: 'סמל המועדון', en: 'The club badge' },
      { key: 'run-06orange', x: 240, y: 734, part: 'logo', he: 'בכתום', en: 'In orange' },
      { key: 'run-07text', x: 225, y: 301, part: 'text', he: 'נוגעים בכותרת', en: 'Tap the title' },
      { key: 'run-08english', x: 49, y: 665, part: 'text', he: 'באנגלית', en: 'In English' },
      { key: 'run-09bg', x: 305, y: 501, part: 'background', he: 'נוגעים ברקע', en: 'Tap the background' },
      { key: 'run-10sticker', x: 73, y: 630, part: 'background', he: 'מדבקה שקופה, לכל תמונה', en: 'A clear sticker, for any photo' },
      { key: 'run-11done', x: 50, y: 28, he: '"סיום", ומשתפים', en: '"Done", and share' },
      ],
      he: {
        title: 'כל חלק בכרטיס, איך שבא לכם',
        body: 'לוחצים "עריכה" ונוגעים בחלק שרוצים לשנות: אילו מספרים, איזה לוגו ובאיזה צבע, כותרת ושפה, ורקע או מדבקה שקופה.',
        cta: 'לערוך את הריצה האחרונה',
        kicker: 'חדש · עורכים הכול',
        where: 'בעורך השיתוף: הכפתור "עריכה" למעלה',
      },
      en: {
        title: 'Every part of the card, your way',
        body: 'Tap "Edit", then the part you want to change: which numbers, which logo and colour, the title and language, the background or a clear sticker.',
        cta: 'Edit my last run',
        kicker: 'New · Edit everything',
        where: 'In the share editor: the "Edit" button at the top',
      },
    },
    he: {
      title: 'כרטיס לכל ריצה, בשש תצוגות',
      body: 'ק״מ אחרי ק״מ, מסלול, שורת נתונים ועוד. בוחרים אילו מספרים נכנסים, לוגו ורקע, ושולחים לסטורי.',
      cta: 'לנסות על הריצה האחרונה',
      kicker: 'חדש · שיתוף אימון',
      where: 'בכל ריצה: הכפתור "שיתוף"',
    },
    en: {
      title: 'A card for every run, six ways',
      body: 'KM splits, route, a stats bar and more. Pick the numbers, the logo and the background, then send it to your story.',
      cta: 'Try it on your last run',
      kicker: 'New · Share a run',
      where: 'On every run: the "Share" button',
    },
  },
  {
    slug: 'week-editor-2026-09',
    publishedAt: '2026-09-30',
    href: '/dashboard/share?what=week',
    cards: [
      { key: 'week-totals', he: 'סיכום', en: 'Totals' },
      { key: 'week-days', he: 'יום אחרי יום', en: 'Day by day' },
      { key: 'week-bar', he: 'שורת נתונים', en: 'Stats bar' },
      { key: 'week-body', he: 'גוף', en: 'Body' },
      { key: 'week-minimal', he: 'מינימלי', en: 'Minimal' },
    ],
    demo: {
      first: 'week-00clean',
      steps: [
      { key: 'week-01edit', x: 55, y: 28, he: 'לוחצים "עריכה"', en: 'Tap "Edit"' },
      { key: 'week-02numbers', x: 286, y: 180, part: 'numbers', he: 'נוגעים במספרים', en: 'Tap the numbers' },
      { key: 'week-02b-offcal', x: 240, y: 673, part: 'numbers', he: 'מורידים את הקלוריות', en: 'Take the calories off' },
      { key: 'week-03bg', x: 305, y: 501, part: 'background', he: 'נוגעים ברקע', en: 'Tap the background' },
      { key: 'week-04sunset', x: 267, y: 630, part: 'background', he: 'שקיעה', en: 'Sunset' },
      { key: 'week-05logo', x: 199, y: 77, part: 'logo', he: 'נוגעים בלוגו', en: 'Tap the logo' },
      { key: 'week-06badge', x: 317, y: 620, part: 'logo', he: 'סמל המועדון', en: 'The club badge' },
      { key: 'week-07text', x: 279, y: 171, part: 'text', he: 'נוגעים בכותרת', en: 'Tap the title' },
      { key: 'week-08marathon', x: 94, y: 664, part: 'text', he: '"בדרך למרתון"', en: '"On the way to the marathon"' },
      { key: 'week-09done', x: 51, y: 28, he: '"סיום", ומשתפים', en: '"Done", and share' },
      ],
      he: {
        title: 'אתם מחליטים מה נכנס לשבוע',
        body: 'שמונה מספרים, כולל שינה ודופק מנוחה: נגיעה מורידה או מחזירה, וגרירה מחליפה סדר. ורקע, לוגו וכותרת משלכם.',
        cta: 'לערוך את השבוע שלי',
        kicker: 'חדש · עורכים את השבוע',
        where: 'בכרטיס השבועי: "שיתוף", ואז "עריכה"',
      },
      en: {
        title: 'You decide what goes on your week',
        body: 'Eight numbers, sleep and resting heart rate included: a tap takes one off or puts it back, a drag swaps the order. And your own background, logo and title.',
        cta: 'Edit my week',
        kicker: 'New · Edit your week',
        where: 'On the weekly card: "Share", then "Edit"',
      },
    },
    he: {
      title: 'השבוע שלך, מוכן לשיתוף',
      body: 'ק״מ, שינה ודופק מנוחה מול שבוע שעבר, בחמישה לוקים. אתם בוחרים מה נכנס ובאיזה סדר.',
      cta: 'לשתף את השבוע שלי',
      kicker: 'חדש · סיכום שבועי',
      where: 'בכל מוצאי שבת, בראש הפיד',
    },
    en: {
      title: 'Your week, ready to share',
      body: 'Distance, sleep and resting heart rate against last week, in five looks. You pick what goes on and in what order.',
      cta: 'Share my week',
      kicker: 'New · Weekly summary',
      where: 'Every Saturday evening, at the top of your feed',
    },
  },
];

export interface WhatsNewContent {
  entries: WhatsNewEntry[];
  /** The "and N more" list under the headlines. Empty before the evening. */
  more: ShownNote[];
}

/**
 * What the sheet holds. Before the evening: the hand-written entries plus the
 * starred release notes, as it always was. With it: the two headlines, any
 * starred note they do not already cover, and under them every other member
 * note released to this bundle since EVENING_SINCE, newest first.
 *
 * Staff notes are dropped here too and not only by the server, because the
 * super user's own answer carries them and the rehearsal must show him what a
 * member gets.
 */
export function composeWhatsNew(
  releases: WhatsNewRelease[], appVersion: string, evening: boolean,
): WhatsNewContent {
  if (!evening) return { entries: [...WHATS_NEW, ...releaseEntries(releases, appVersion)], more: [] };
  const member = releases.map(r => ({
    ...r,
    notes: r.notes.filter(n => n.audience !== 'staff' && !EVENING_FOLDED.includes(n.id)),
  }));
  const seen = new Set<string>();
  const more = member
    .filter(r => compareAppVersions(appVersion, r.app_version) >= 0)
    .sort((a, b) => compareAppVersions(b.app_version, a.app_version))
    .flatMap(r => r.notes)
    .filter(n => !n.featured && n.date >= EVENING_SINCE && !seen.has(n.id) && !!seen.add(n.id))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { entries: [...EVENING_ENTRIES, ...releaseEntries(member, appVersion)], more };
}
