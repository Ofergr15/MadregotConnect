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
// The academy page was dropped from the tour on his word (2026-10-01): it is
// not open yet.
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
export const EVENING_OPEN = true;

/**
 * The 10-18 release's own switch (Ofer, 2026-10-18: "production, What's New only
 * me"). The build ships to everyone, but until this is true its tour is the super
 * user's only: everyone else's sheet composes as it did before the evening
 * (composeWhatsNew below), so nothing of it opens for a member, and his release
 * push (`?tour=1018`) is his to watch first. Flipping it is the release.
 */
export const RELEASE_OPEN = true;

/** The hook that reads the switch is lib/use-evening-release.ts, kept out of here so node tests need no React. */

/**
 * The headlines' date: the day before the switch flips, set in that commit. A
 * device shows only entries dated after the day it first reached the feed
 * (ledger.ts rule 1), so the eve of the release reaches every device a member had
 * by then, one first opened since the tour was written included. A device newer
 * than that still gets the tour from the release push (TOUR_PARAM).
 */
export const EVENING_DATE = '2026-10-17';

/**
 * `/feed?tour=<TOUR_VALUE>`, the release push's link: the feed opens the tour whatever the
 * ledger says, because the reader asked for it by tapping (WhatsNewAutoSheet).
 */
export const TOUR_PARAM = 'tour';

/**
 * The release push's value: `/feed?tour=<TOUR_VALUE>`. It changes with each tour
 * release, because the push lands on phones still running the PREVIOUS bundle,
 * and that bundle opens its own (old) tour for its own value and strips the link.
 * A value it does not know survives it, through the update's reload, to the new
 * bundle, which opens the new tour: push, then update, then What's new. '1' (the
 * 10-01 release) is still honoured.
 */
export const TOUR_VALUE = '1018';
export const TOUR_VALUES: readonly string[] = ['1', TOUR_VALUE];

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

/**
 * The tour's last page, "and more" (the 10-18 release, mockup
 * ~/.cache/madregot/mockups/whats-new-batch-1018.html): the smaller things of this
 * release, in his order. A member's list ends with the club items; staff (who run
 * too) get the same list and then theirs, marked `audience: 'staff'`.
 */
export const EVENING_MORE: readonly string[] = [
  'b18-run-name', 'b18-week-watch', 'b18-watch-2000', 'b18-watch-reconnect',
  'b18-surveys', 'b18-day-session', 'b18-day-push-text',
];

/**
 * The "and more" notes of this release, written here because none of them has a
 * release note of its own (the batch ships as one version).
 */
export const EVENING_EXTRA: readonly ShownNote[] = [
  { id: 'b18-run-name', date: EVENING_DATE, kind: 'feature', icon: '🏷️', title: 'שם הריצה כמו בסטרבה', body: 'ריצת בוקר, ריצת ערב. באימון איכות: השם שהמאמן נתן לאימון.', featured: false, edited: false },
  { id: 'b18-week-watch', date: EVENING_DATE, kind: 'feature', icon: '⌚', title: '"השבוע בשעון"', body: 'בראש הפיד רואים מה לא הגיע לשעון, ומתחברים מחדש בנגיעה.', featured: false, edited: false },
  { id: 'b18-watch-2000', date: EVENING_DATE, kind: 'feature', icon: '🌙', title: 'תזכורת אחת ב־20:00', body: 'כשהאימון של מחר לא בשעון: הודעה אחת בערב, עם הסיבה.', featured: false, edited: false },
  { id: 'b18-watch-reconnect', date: EVENING_DATE, kind: 'feature', icon: '🔁', title: 'מתחברים, והאימונים נשלחים לבד', body: 'אחרי חיבור מחדש של גרמין, מה שחיכה מגיע לשעון.', featured: false, edited: false },
  { id: 'b18-surveys', date: EVENING_DATE, kind: 'feature', icon: '📊', title: 'סקרים בפיד', body: 'מצביעים בנגיעה, ורואים את התוצאות.', featured: false, edited: false },
  { id: 'b18-day-session', date: EVENING_DATE, kind: 'feature', icon: '🏃', title: 'אימון ליום אחד: אותו עורך כמו במתכנן', body: 'טווחי קצב, קצב לכל דבוקה, הליכה כהתאוששות.', featured: false, edited: false, audience: 'staff' },
  { id: 'b18-day-push-text', date: EVENING_DATE, kind: 'feature', icon: '🔔', title: 'טקסט ההתראה לחברים, לעריכה', body: 'רואים מה יישלח, ומשנים לפני השליחה.', featured: false, edited: false, audience: 'staff' },
];

/**
 * The 10-18 release (mockup ~/.cache/madregot/mockups/whats-new-batch-1018.html):
 * seven pages for the club, in a logical order (the feed you land on, its birthdays and
 * cheers, then your run, your profile, your records, your fitness, then the club's photos), and for staff, who run too, the same five
 * followed by theirs (`audience: 'staff'`). Frames are 540x960 crops of real
 * captures, made by ~/.cache/madregot/wn-lab/export-1018.py.
 */
export const EVENING_ENTRIES: WhatsNewEntry[] = [
  {
    slug: 'b18-feed',
    publishedAt: EVENING_DATE,
    href: '/feed',
    cards: [
      { key: 'b18-feed-top', he: 'המרוץ, האימון וימי ההולדת', en: 'The race, the session and the birthdays' },
      { key: 'b18-feed-runs', he: 'כרטיסי הריצה', en: 'The run cards' },
    ],
    he: { title: 'הפיד, מחדש', body: 'בראש הפיד: מי חוגג היום, כמה שבועות נשארו למרוץ שלך, והאימון הבא. ומתחת: כרטיסי ריצה נקיים, עם המספרים החשובים בגדול.', cta: 'לפיד', kicker: 'חדש · פיד', where: 'הלשונית "פיד" למטה' },
    en: { title: 'Your feed, redone', body: 'At the top: who is celebrating today, how many weeks to your race, and the next session. Below: clean run cards, the numbers that matter up front.', cta: 'To the feed', kicker: 'New · Feed', where: 'The "Feed" tab at the bottom' },
  },
  {
    slug: 'b18-celebrations',
    publishedAt: EVENING_DATE,
    href: '/feed',
    cards: [
      { key: 'b18-celebrations', he: 'יום הולדת', en: 'A birthday' },
      { key: 'b18-celebrations-cheer', he: 'מרתון', en: 'A marathon' },
    ],
    he: { title: 'ימי הולדת וחגיגות, בפיד', body: '"חוגגים היום" בראש הפיד: יום הולדת עולה לבד, ושיא אישי או מרתון מהיר מקבלים ברכה מהמאמנים. נגיעה בעיגול פותחת את החגיגה, עם לייק ותגובה.', cta: 'לפיד', kicker: 'חדש · חגיגות', where: 'בפיד' },
    en: { title: 'Birthdays and celebrations, on the feed', body: '"Celebrating today" at the top of the feed: birthdays go up by themselves, and a personal best or a fast marathon gets a cheer from the coaches. Tap a circle to open it, like and comment.', cta: 'To the feed', kicker: 'New · Celebrations', where: 'On the feed' },
  },
  {
    slug: 'b18-run-page',
    publishedAt: EVENING_DATE,
    href: '/dashboard/profile',
    cards: [
      { key: 'b18-run-map', he: 'המפה והמספרים', en: 'The map and the numbers' },
      { key: 'b18-run-charts', he: 'הגרפים לאורך הריצה', en: 'The charts along the run' },
      { key: 'b18-run-reps', he: 'החזרות מול היעד', en: 'The reps against the target' },
    ],
    he: { title: 'עמוד ריצה חדש', body: 'המפה בגדול, ועליה מי רץ, השם והמספרים. גרפים עם צירים שזזים יחד, החזרות מול היעד של הדבוקה שלך, ועוד מדדים.', cta: 'לריצה האחרונה שלי', kicker: 'חדש · עמוד ריצה', where: 'נגיעה בריצה, בפיד או בפרופיל' },
    en: { title: 'A new run page', body: "The map up top with who ran, the name and the numbers. Charts with axes that move together, your reps against your pack's target, and more metrics.", cta: 'My last run', kicker: 'New · Run page', where: 'Tap a run, on the feed or your profile' },
  },
  {
    slug: 'b18-profile',
    publishedAt: EVENING_DATE,
    href: '/dashboard/profile',
    cards: [
      { key: 'b18-profile', he: 'הפעילות שלך', en: 'Your activity' },
      { key: 'b18-profile-plan', he: 'התוכנית השבועית, יום אחרי יום', en: 'The weekly plan, day by day' },
    ],
    he: { title: 'הפרופיל, מחדש', body: 'נפתח על הפעילות שלך. ארבע לשוניות: פעילות, סטטיסטיקה, שיאים והגדרות, וכל ההגדרות במקום אחד.', cta: 'לפרופיל שלי', kicker: 'חדש · פרופיל', where: 'הלשונית "פרופיל" למטה' },
    en: { title: 'Your profile, redone', body: 'It opens on your activity. Four tabs: activity, stats, records and settings, with every setting in one place.', cta: 'My profile', kicker: 'New · Profile', where: 'The "Profile" tab at the bottom' },
  },
  {
    slug: 'b18-records',
    publishedAt: EVENING_DATE,
    href: '/dashboard/profile?tab=records',
    cards: [
      { key: 'b18-records', he: 'חצי מרתון · 12 שבירות', en: 'Half marathon · 12 records' },
    ],
    he: { title: 'השיא שלך, לאורך זמן', body: 'בכל מרחק: הגרף של כל הפעמים שהשיא נשבר, בכמה שיפרת, ומאיזו ריצה.', cta: 'לשיאים שלי', kicker: 'חדש · שיאים', where: 'פרופיל ← שיאים' },
    en: { title: 'Your record, over time', body: 'For every distance: a chart of each time the record fell, by how much, and on which run.', cta: 'My records', kicker: 'New · Records', where: 'Profile → Records' },
  },
  {
    slug: 'b18-fitness',
    publishedAt: EVENING_DATE,
    href: '/dashboard/profile?tab=stats',
    cards: [
      { key: 'b18-fitness', he: 'קצב באותו דופק', en: 'Pace at the same heart rate' },
    ],
    he: { title: 'באותו דופק, מהר יותר?', body: 'הקצב שלך בכל טווח דופק, לאורך חודשים. כשהקו עולה, אתה בכושר טוב יותר.', cta: 'לסטטיסטיקה שלי', kicker: 'חדש · כושר', where: 'פרופיל ← סטטיסטיקה' },
    en: { title: 'Same heart rate, faster?', body: 'Your pace in each heart-rate band, over months. When the line climbs, you are fitter.', cta: 'My stats', kicker: 'New · Fitness', where: 'Profile → Stats' },
  },
  {
    slug: 'b18-photos',
    publishedAt: EVENING_DATE,
    href: '/feed',
    cards: [
      { key: 'b18-photos-push', he: 'ההתראה בטלפון', en: 'The notification on your phone' },
      { key: 'b18-photos-feed', he: 'הכרטיס בפיד', en: 'The card on the feed' },
    ],
    he: { title: 'התמונות מהאימון, ישר באפליקציה', body: 'אחרי כל אימון איכות ואירוע, התמונות עולות לפיד לבד, ומגיעה התראה לטלפון. לייק, תגובה, ונגיעה לכל התמונות.', cta: 'לפיד', kicker: 'חדש · תמונות', where: 'הפיד, וההתראה בטלפון' },
    en: { title: 'Session photos, straight in the app', body: 'After every quality session and event the photos reach the feed by themselves, with a notification on your phone. Like, comment, tap for all of them.', cta: 'To the feed', kicker: 'New · Photos', where: 'The feed, and the notification on your phone' },
  },
  {
    slug: 'b18-management',
    publishedAt: EVENING_DATE,
    audience: 'staff',
    href: '/dashboard/coach-tools',
    cards: [
      { key: 'b18-mgmt', he: 'ניהול', en: 'Management' },
      { key: 'b18-mgmt-coach', he: 'היום לפי מתאמן', en: 'Today by trainee' },
    ],
    he: { title: '"ניהול" לפי התפקיד שלך', body: 'בתפריט למטה: הפיד, לוח הבקרה והתוכנית כמו לכל רץ, ודלת אחת לעבודה. נוכחות, משובים וספורטאים בראש העמוד, ונקודה כשמשהו מחכה.', cta: 'לניהול', kicker: 'חדש · לצוות', where: 'התפריט למטה ← ניהול' },
    en: { title: '"Management", by your role', body: 'The bottom bar: feed, dashboard and program like any runner, and one door for the job. Attendance, feedback and athletes at the top, with a dot when something is waiting.', cta: 'Management', kicker: 'New · Staff', where: 'Bottom bar → Management' },
  },
  {
    slug: 'b18-publish',
    publishedAt: EVENING_DATE,
    audience: 'staff',
    href: '/dashboard/content',
    cards: [
      { key: 'b18-publish', he: 'לפרסם', en: 'Publish' },
      { key: 'b18-cheer', he: 'ברכה עם תיוג', en: 'A cheer with a tag' },
      { key: 'b18-survey', he: 'סקר בפיד', en: 'A survey on the feed' },
    ],
    he: { title: 'הודעה, ברכה או סקר, ממקום אחד', body: '"תוכן" ← לפרסם: הודעה עם תמונה, ברכה עם הצעות מהשיאים והמרוצים, או סקר. הכל עולה לפיד.', cta: 'לפרסם', kicker: 'חדש · לצוות', where: 'ניהול ← תוכן' },
    en: { title: 'A message, a cheer or a survey, from one place', body: 'Content → Publish: a message with a photo, a cheer with suggestions from records and races, or a survey. It all goes to the feed.', cta: 'Publish', kicker: 'New · Staff', where: 'Management → Content' },
  },
  {
    slug: 'b18-social',
    publishedAt: EVENING_DATE,
    audience: 'staff',
    href: '/dashboard/social',
    cards: [
      { key: 'b18-social', he: 'מה מתוזמן ומה נוצר', en: 'What is scheduled, what was made' },
      { key: 'b18-social-new', he: 'תיקייה חדשה, מתי שרוצים', en: 'A new folder, any time' },
    ],
    he: { title: 'תיקייה לתמונות, לבד', body: 'ערב לפני כל אימון איכות נוצרת תיקייה בדרייב ומגיעה אליך. מעלים אליה, והתמונות עולות לפיד עם התראה לכל המועדון. לאירוע: "תיקייה חדשה עכשיו".', cta: 'ל־Social', kicker: 'חדש · לצוות', where: 'תפריט ← Social' },
    en: { title: 'A photo folder, made for you', body: 'The evening before each quality session a Drive folder is made and sent to you. Upload to it, and the photos reach the feed with a notification to the whole club. For an event: "New folder now".', cta: 'Open Social', kicker: 'New · Staff', where: 'Menu → Social' },
  },
  {
    slug: 'b18-watch-send',
    publishedAt: EVENING_DATE,
    audience: 'staff',
    href: '/dashboard/plan/new',
    cards: [
      { key: 'b18-watch-send', he: 'כולם · דבוקה · יחידים', en: 'Everyone · a pack · people' },
      { key: 'b18-watch-track', he: 'מעקב חי', en: 'Live tracking' },
    ],
    he: { title: 'שולחים לשעונים, ורואים מי קיבל', body: 'כולם, דבוקה או יחידים, באימון ליום אחד ובמתכנן. מעקב שמתעדכן לבד: מי בשעון, מי נכשל ולמה.', cta: 'למתכנן', kicker: 'חדש · לצוות', where: 'אימון ליום אחד / מתכנן ← לשעונים' },
    en: { title: 'Send to the watches, and see who got it', body: 'Everyone, a pack or single people, from a one-day session or the planner. Tracking that updates by itself: who has it, who failed and why.', cta: 'The planner', kicker: 'New · Staff', where: 'One-day session / planner → To the watches' },
  },
];

export interface WhatsNewContent {
  entries: WhatsNewEntry[];
  /** The "and N more" list under the headlines (EVENING_MORE). Empty before the evening. */
  more: ShownNote[];
}

/**
 * What the sheet holds. Before the evening: the hand-written entries plus the
 * starred release notes, as it always was. With it: the two headlines, any
 * starred note they do not already cover, and under them the EVENING_MORE
 * notes released to this bundle, in that order (a starred one has its row already).
 *
 * Staff notes are dropped here too and not only by the server, because the
 * super user's own answer carries them and the rehearsal must show him what a
 * member gets. With `staff`, the staff headlines and notes follow the members'.
 */
export function composeWhatsNew(
  releases: WhatsNewRelease[], appVersion: string, evening: boolean, staff = false, superUser = false,
): WhatsNewContent {
  if (!evening || (!RELEASE_OPEN && !superUser)) return { entries: [...WHATS_NEW, ...releaseEntries(releases, appVersion)], more: [] };
  const member = releases.map(r => ({
    ...r,
    notes: r.notes.filter(n => n.audience !== 'staff' && !EVENING_FOLDED.includes(n.id)),
  }));
  const released = releases
    .filter(r => compareAppVersions(appVersion, r.app_version) >= 0)
    .flatMap(r => r.notes)
    .filter(n => n.audience !== 'staff' && !n.featured)
    .concat(EVENING_EXTRA.filter(n => staff || n.audience !== 'staff'));
  const more = EVENING_MORE
    .map(id => released.find(n => n.id === id))
    .filter((n): n is ShownNote => !!n);
  const headlines = EVENING_ENTRIES.filter(e => staff || e.audience !== 'staff');
  return { entries: [...headlines, ...releaseEntries(member, appVersion)], more };
}
