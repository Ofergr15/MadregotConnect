/**
 * The automatic bug detectors — the half of the feedback loop that doesn't wait
 * for somebody to complain.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * The reports board only ever hears about failures somebody can SEE: a blank
 * screen, a button that doesn't respond. Everything that fails by being quiet is
 * invisible to it — an expired Garmin token that stops syncing, a push endpoint
 * Apple returned 201 for and then dropped, a plan page the parser skipped. An
 * athlete whose runs simply don't appear doesn't think "there's a bug"; they
 * think they haven't been running enough.
 *
 * ── THE FOUR RULES, which are what keep this from becoming noise ────────────
 *
 * 1. A FINDING IS NOT A BUG. Every detector proposes; staff decides. "Not a bug"
 *    is recorded against the detector as a visible false positive, because a
 *    detector that cried wolf three times has to LOOK like it — otherwise the
 *    next week starts with ignoring the whole board.
 * 2. PROOF OR SILENCE. A finding must be able to name the people it affected.
 *    Anything that can't ("response time went up") is a WEAK SIGNAL: its own
 *    drawer, no alert. That distinction is the difference between a board you
 *    open in the morning and one you abandon in week two.
 * 3. ONE QUEUE. There is no second board. A finding is a row in `feedback` like
 *    any other report, so a finding and the three humans who reported the same
 *    thing collapse into one issue with four reporters.
 * 4. WHICH VERSION STARTED IT. `first_seen_version` turns an hour of bisecting
 *    into one line.
 *
 * ── WHAT'S HERE ─────────────────────────────────────────────────────────────
 *
 * All eleven, in two groups.
 *
 * The first five are queries over tables that already existed, and they include
 * all three of the silent failures, which were the actual reason to build this.
 *
 * The next five read `client_events` (migration 118) — the browser's own account
 * of what went wrong, which nothing on the server can otherwise know. They were
 * deliberately left until the first five had run, so the table could be written
 * against the fields that turned out to be missing rather than the fields the
 * design guessed at. Each of them degrades to "not checked" rather than to a
 * cheerful zero while the table is absent; see `run.ts`.
 *
 * The eleventh, `suspicious_pace`, needs no new schema at all and is here for a
 * different reason from the rest: it is the only detector that looks for data
 * that is WRONG rather than data that is missing.
 *
 * Everything in this file is PURE — it takes rows and returns findings, so each
 * rule can be tested against the shape that produced the real-world failure
 * rather than against a mock of Supabase.
 */

import { compareVersions, errorShape, type ClientEventRow } from './client-events';

/** Every detector in the design. */
export type DetectorKey =
  | 'garmin_silent'
  | 'push_orphan'
  | 'parse_gap'
  | 'duplicate_athlete'
  | 'phantom_activity'
  | 'client_error'
  | 'blank_screen'
  | 'dropped_form'
  | 'stuck_version'
  | 'server_error'
  | 'suspicious_pace';

/** Every detector that has a rule written for it. */
export const LIVE_DETECTORS: DetectorKey[] = [
  'garmin_silent',
  'push_orphan',
  'parse_gap',
  'duplicate_athlete',
  'phantom_activity',
  'client_error',
  'blank_screen',
  'dropped_form',
  'stuck_version',
  'server_error',
  'suspicious_pace',
];

/**
 * The five that cannot run until `client_events` exists.
 *
 * They are NOT removed from `LIVE_DETECTORS` — a detector with a rule written for
 * it is live. This list is what lets a pass report them as "not checked" while
 * migration 118 is unapplied, which is a different statement from "checked, found
 * nothing" and the only one of the two that is true.
 */
export const CLIENT_DETECTORS: DetectorKey[] = [
  'client_error',
  'blank_screen',
  'dropped_form',
  'stuck_version',
  'server_error',
];

/** Nothing left in the design that has no rule. Kept so callers don't break. */
export const PENDING_DETECTORS: DetectorKey[] = [];

/**
 * A finding: something true about the data, with the evidence attached.
 *
 * `evidence.how` is not decoration. A detector that shows a conclusion without
 * showing how it got there is a black box you cannot disagree with, and the one
 * action the board most needs to support is disagreeing with it.
 */
export interface Finding {
  detector: DetectorKey;
  /**
   * Stable across runs for the same underlying fact, so tonight's pass updates
   * last night's finding instead of opening a second copy of it. Anything that
   * varies with the run (a day count, "as of" date) must stay OUT of it.
   */
  key: string;
  /** One line, in the coach's language, stating the fact rather than a diagnosis. */
  title: string;
  /** PEOPLE, not events: 400 errors from one athlete on an ancient phone matter
   *  less than one error hitting seven. Zero means there is no finding at all. */
  affected: number;
  /** `weak` never alerts and lives in its own drawer — see rule 2. */
  strength: 'finding' | 'weak';
  evidence: {
    /** How this was found, in words, including what it deliberately did NOT do. */
    how: string;
    /** What a human still has to decide, if anything. */
    unknown?: string;
    /** The athletes it touches, for the faces row. */
    athleteIds: string[];
    /** Countable specifics, rendered as a table. */
    facts: Record<string, string | number>;
  };
}

/** Rows a detector reads. Deliberately narrow: no detector receives a credential. */
export interface ProviderAthlete {
  id: string;
  name: string | null;
  /** Most recent activity of ANY source, or null if there has never been one. */
  lastActivityAt: string | null;
  /** True when a provider token is on the row. Derived by the caller with an
   *  `is not null` FILTER — the encrypted blob itself is never selected. */
  garminConnected: boolean;
  stravaConnected: boolean;
}

export interface PushSubscriptionRow {
  id: string;
  athlete_id: string;
  created_at: string;
  last_success_at: string | null;
}

export interface PlanRow {
  id: string;
  athlete_id: string | null;
  week_start_date: string;
  /** How many workouts the parse produced for this plan. */
  workoutCount: number;
}

export interface AthleteNameRow {
  id: string;
  name: string | null;
  /** True when the row was created by a Strava login (a synthetic local email). */
  synthetic: boolean;
}

export interface ActivityRow {
  id: string;
  athlete_id: string;
  start_time: string | null;
  duration: number | null;
  distance: number | null;
  has_polyline: boolean | null;
  source: string | null;
}

const DAY_MS = 86_400_000;

function daysBetween(from: string, to: number): number {
  return Math.floor((to - new Date(from).getTime()) / DAY_MS);
}

/** Two initials, the panel's face idiom. */
function names(rows: Array<{ name: string | null }>): string {
  return rows.map(r => (r.name || '?').trim().split(/\s+/)[0]).join(', ');
}

/**
 * ── garmin_silent ── The token expired and the app still says "Connected".
 *
 * The proof is a GAP, not an error: a connected athlete with no activity for
 * days, during a stretch when plenty of other athletes synced normally. The
 * second half is what makes it a finding rather than a guess — without it, a
 * quiet week for the whole club (a holiday, a race taper) reads as everybody's
 * token breaking at once.
 *
 * It never tries to authenticate as them to check. That would mean touching
 * credentials to answer a question the absence of data already answers.
 */
export function detectGarminSilent(
  athletes: ProviderAthlete[],
  now: number,
  silentDays = 10,
): Finding | null {
  const connected = athletes.filter(a => a.garminConnected);
  const syncedRecently = athletes.filter(
    a => a.lastActivityAt && daysBetween(a.lastActivityAt, now) <= 3,
  );
  // Fewer than three athletes syncing at all means the club is quiet, not broken.
  if (syncedRecently.length < 3) return null;

  const silent = connected.filter(
    a => !a.lastActivityAt || daysBetween(a.lastActivityAt, now) >= silentDays,
  );
  if (!silent.length) return null;

  const gaps = silent.map(a => (a.lastActivityAt ? daysBetween(a.lastActivityAt, now) : 999));
  return {
    detector: 'garmin_silent',
    key: `garmin_silent:${silent.map(a => a.id).sort().join(',')}`,
    title: `גרמין מחובר אבל לא סונכרן אימון כבר ${Math.max(...gaps)} יום`,
    affected: silent.length,
    strength: 'finding',
    evidence: {
      how:
        `הטוקן פג — האפליקציה עוד מראה מחובר. הסימן הוא הפער: לאתלטים האלה יש חיבור גרמין ואפס ` +
        `אימונים, ובאותם ימים ${syncedRecently.length} אתלטים אחרים סונכרנו רגיל. ` +
        `הבדיקה לא מנסה להתחבר בשמם.`,
      unknown: silent.some(a => a.stravaConnected)
        ? 'לחלקם יש גם סטרבה, כך שייתכן שהם רצים ואנחנו פשוט לא רואים דרך גרמין.'
        : undefined,
      athleteIds: silent.map(a => a.id),
      facts: {
        'שקטים': names(silent),
        'ימים ללא סנכרון': gaps.join(', '),
        'סונכרנו רגיל באותם ימים': syncedRecently.length,
      },
    },
  };
}

/**
 * ── push_orphan ── Apple returns 201 and drops it anyway.
 *
 * 201 is a RECEIPT, not a delivery, which is exactly how a total outage once
 * read as "everything sent". The available proof is a subscription that has
 * never once succeeded while other subscriptions were succeeding in the same
 * period: the club's push works, this endpoint's doesn't.
 *
 * (The design wanted `sent_count` rising against a frozen `last_success_at`.
 * There is no `sent_count` column, so this uses the half that does exist —
 * naming what it cannot see rather than inventing it.)
 */
export function detectPushOrphan(
  subs: PushSubscriptionRow[],
  now: number,
  staleDays = 14,
): Finding | null {
  const healthy = subs.filter(
    s => s.last_success_at && daysBetween(s.last_success_at, now) <= 3,
  );
  // If nothing at all is succeeding, this is an outage, not orphaned endpoints —
  // and an outage is not something this detector can tell you anything useful about.
  if (!healthy.length) return null;

  const orphaned = subs.filter(s => {
    if (daysBetween(s.created_at, now) < 7) return false;
    return !s.last_success_at || daysBetween(s.last_success_at, now) >= staleDays;
  });
  if (!orphaned.length) return null;

  const people = [...new Set(orphaned.map(s => s.athlete_id))];
  return {
    detector: 'push_orphan',
    key: `push_orphan:${orphaned.map(s => s.id).sort().join(',')}`,
    title: `${orphaned.length} רשומות פוש רשומות אבל לא הצליחו אף פעם — נשלח בלוח, כלום בטלפון`,
    affected: people.length,
    strength: 'finding',
    evidence: {
      how:
        `201 של אפל הוא קבלה ולא הצלחה, וזה מה שגרם לניתוק שלם להיראות כמו הכל נשלח. ` +
        `הרשומות האלה נרשמו לפני יותר משבוע ומעולם לא רשמו הצלחה, בזמן ש-${healthy.length} ` +
        `רשומות אחרות כן הצליחו בשלושת הימים האחרונים.`,
      unknown: 'ייתכן שהמכשיר פשוט הוסר — ניקוי של רשומה מיותמת הוא בטוח בשני המקרים.',
      athleteIds: people,
      facts: {
        'רשומות מיותמות': orphaned.length,
        'אתלטים': people.length,
        'רשומות תקינות': healthy.length,
      },
    },
  };
}

/**
 * ── parse_gap ── A plan came out much thinner than its siblings.
 *
 * The parse drops whole pages of a PDF without erroring, and nobody reports a
 * workout they don't know existed. Counting is enough to find it: for one week,
 * compare each plan's workout count with the median of the others. A plan at or
 * below half the median either belongs to a genuinely lighter group or lost a
 * page — both are worth a look, and only one of them is fine.
 *
 * Deliberately NOT "which page produced nothing": the parser does not record a
 * page number on a workout, so that version of the check cannot be written
 * honestly today.
 */
export function detectParseGap(plans: PlanRow[]): Finding | null {
  const byWeek = new Map<string, PlanRow[]>();
  for (const p of plans) {
    const list = byWeek.get(p.week_start_date) || [];
    list.push(p);
    byWeek.set(p.week_start_date, list);
  }

  const thin: Array<{ plan: PlanRow; median: number }> = [];
  for (const [, week] of byWeek) {
    // Three is the floor for a median to mean anything.
    if (week.length < 3) continue;
    const counts = week.map(p => p.workoutCount).sort((a, b) => a - b);
    const median = counts[Math.floor(counts.length / 2)];
    if (median < 3) continue;
    for (const plan of week) {
      if (plan.workoutCount * 2 <= median) thin.push({ plan, median });
    }
  }
  if (!thin.length) return null;

  const worst = thin[0];
  return {
    detector: 'parse_gap',
    key: `parse_gap:${thin.map(t => t.plan.id).sort().join(',')}`,
    title:
      `לתוכנית של שבוע ${worst.plan.week_start_date} נוצרו ${worst.plan.workoutCount} אימונים ` +
      `כשלאחרות באותו שבוע נוצרו ${worst.median}`,
    affected: new Set(thin.map(t => t.plan.athlete_id).filter(Boolean)).size || thin.length,
    strength: 'finding',
    evidence: {
      how:
        `ספירה, לא איכות: אין צורך להבין את התוכן. אם תוכנית יצאה עם חצי מהאימונים של האחרות ` +
        `באותו שבוע — או שהשבוע שלה באמת קל יותר, או שהפרסר דילג על עמוד. שתי האפשרויות שוות ` +
        `בדיקה ורק אחת מהן תקינה.`,
      unknown: 'אם השבוע באמת היה קל יותר לקבוצה הזאת — את זה אפשר לדעת רק מהמקור.',
      athleteIds: thin.map(t => t.plan.athlete_id).filter((x): x is string => !!x),
      facts: {
        'תוכניות דקות': thin.length,
        'אימונים שנוצרו': thin.map(t => t.plan.workoutCount).join(', '),
        'חציון באותו שבוע': worst.median,
      },
    },
  };
}

/**
 * ── duplicate_athlete ── One person, two rows, one of them made by Strava.
 *
 * A Strava login that doesn't recognise an existing member creates a second
 * athlete, and from then on the person's history is split down the middle while
 * both halves look complete from the inside. Matching is on the first name plus
 * the presence of a synthetic row, because the synthetic row is the signature of
 * the path that causes it.
 */
export function detectDuplicateAthlete(rows: AthleteNameRow[]): Finding | null {
  const byName = new Map<string, AthleteNameRow[]>();
  for (const r of rows) {
    const key = (r.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!key) continue;
    const list = byName.get(key) || [];
    list.push(r);
    byName.set(key, list);
  }

  const pairs = [...byName.values()].filter(
    list => list.length > 1 && list.some(r => r.synthetic),
  );
  if (!pairs.length) return null;

  return {
    detector: 'duplicate_athlete',
    key: `duplicate_athlete:${pairs.flat().map(r => r.id).sort().join(',')}`,
    title: `${pairs.length} אנשים מופיעים בשתי שורות — אחת מהן נוצרה מהתחברות לסטרבה`,
    affected: pairs.length,
    strength: 'finding',
    evidence: {
      how:
        `אותו שם בשתי שורות, כשלפחות אחת מהן נוצרה בהתחברות סטרבה. השורה הסינתטית היא החתימה ` +
        `של המסלול שמייצר את זה, ומאותו רגע ההיסטוריה של האדם מפוצלת לשניים כששני החצאים ` +
        `נראים שלמים מבפנים.`,
      athleteIds: pairs.flat().map(r => r.id),
      facts: {
        'שמות כפולים': pairs.map(p => p[0].name || '?').join(', '),
        'שורות מושפעות': pairs.flat().length,
      },
    },
  };
}

/**
 * ── phantom_activity ── The rows that once flooded everybody with notifications.
 *
 * A Strava activity with no GPS and no duration isn't a run — it's a placeholder
 * the feed treated as news (fixed in 2.40.10-12). The check is for the shape
 * itself, so a regression that starts letting them in again is caught by the
 * data rather than by whoever notices their phone buzzing.
 */
export function detectPhantomActivity(activities: ActivityRow[]): Finding | null {
  const phantom = activities.filter(
    a => !a.has_polyline && !a.duration && !a.distance,
  );
  if (!phantom.length) return null;

  const people = [...new Set(phantom.map(a => a.athlete_id))];
  return {
    detector: 'phantom_activity',
    key: `phantom_activity:${phantom.map(a => a.id).sort().join(',')}`,
    title: `${phantom.length} פעילויות נשמרו בלי GPS, בלי זמן ובלי מרחק`,
    affected: people.length,
    strength: 'finding',
    evidence: {
      how:
        `בדיקה של הצורה עצמה: אין polyline, אין duration ואין distance. זה לא ריצה, זה שורה ` +
        `ריקה — וזה בדיוק מה שהציף את כולם בהתראות ב-2.40.10.`,
      athleteIds: people,
      facts: {
        'פעילויות': phantom.length,
        'אתלטים': people.length,
        'מקורות': [...new Set(phantom.map(a => a.source || 'unknown'))].join(', '),
      },
    },
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * The five that read the browser's own account: `client_events`, migration 118.
 *
 * All five GROUP, and all five therefore return a LIST rather than one finding.
 * Three unrelated error shapes in one night are three facts with three stable
 * keys, and folding them into "3 errors happened" would produce a row that can
 * neither be triaged nor closed — you cannot fix a count.
 *
 * All five also share one threshold: TWO PEOPLE. One athlete hitting one error on
 * one phone is a phone. It is filed as a weak signal so it is still visible in
 * the drawer, but it does not alert, because a board that alerts on every ageing
 * Android stops being read in a fortnight. That is rule 2 applied to a kind of
 * evidence that arrives in bulk.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Events of one kind inside a window, newest irrelevant — grouping does the work. */
function inWindow(events: ClientEventRow[], kind: string, now: number, days: number) {
  return events.filter(e => e.kind === kind && daysBetween(e.created_at, now) < days);
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = out.get(k) || [];
    list.push(row);
    out.set(k, list);
  }
  return out;
}

function peopleOf(rows: ClientEventRow[]): string[] {
  return [...new Set(rows.map(r => r.athlete_id).filter((x): x is string => !!x))];
}

/** Two people or it is a weak signal. See the banner above. */
function strengthFor(people: number): 'finding' | 'weak' {
  return people >= 2 ? 'finding' : 'weak';
}

/** The routes a group touched, for the evidence table. */
function routesOf(rows: ClientEventRow[]): string {
  return [...new Set(rows.map(r => r.route || '?'))].slice(0, 5).join(', ');
}

/**
 * ── client_error ── An exception the athlete saw and we did not.
 *
 * Grouped by the error's SHAPE rather than its text (see `errorShape`), because
 * the one failure this most needs to catch — a deploy that leaves phones asking
 * for chunks that no longer exist — arrives as a different message on every
 * device. Ungrouped, it is twelve unrelated singletons; grouped, it is one
 * finding with twelve people on it.
 *
 * It deliberately does NOT try to rank by severity. An uncaught exception is not
 * a severity, it is a fact, and the thing that makes one matter more than another
 * is how many people it reached.
 */
export function detectClientError(events: ClientEventRow[], now: number, days = 3): Finding[] {
  const groups = groupBy(inWindow(events, 'error', now, days), e => errorShape(e.message));
  const out: Finding[] = [];
  for (const [shape, rows] of groups) {
    const people = peopleOf(rows);
    if (!people.length) continue;
    out.push({
      detector: 'client_error',
      key: `client_error:${shape}`,
      title: `שגיאה בדפדפן אצל ${people.length} אתלטים: ${shape}`,
      affected: people.length,
      strength: strengthFor(people.length),
      evidence: {
        how:
          `השגיאה נרשמה מהדפדפן עצמו, לא מהשרת. הקיבוץ הוא לפי הצורה של ההודעה ולא לפי הטקסט ` +
          `המלא — מספרי שורה וגיבובים של קבצים משתנים בכל מכשיר, ובלי הקיבוץ תקלה אחת אחרי ` +
          `דיפלוי נראית כמו שתים-עשרה תקלות נפרדות שאף אחת מהן לא הגיעה לשני אנשים.`,
        unknown: 'הצורה לא אומרת למה זה קרה — היא אומרת שזה קרה, לכמה אנשים, ובאילו מסכים.',
        athleteIds: people,
        facts: {
          'אתלטים': people.length,
          'מופעים': rows.length,
          'מסכים': routesOf(rows),
          'גרסאות': [...new Set(rows.map(r => r.app_version || '?'))].join(', '),
        },
      },
    });
  }
  return out;
}

/**
 * ── blank_screen ── The page loaded and there was nothing in it.
 *
 * The failure nobody reports as a bug, because there is nothing on screen to
 * describe. The client reports it after the route has had time to settle, so this
 * is not "it was empty for a moment" — see `ClientEventReporter`.
 *
 * Grouped by route, because a blank screen is a property of a SCREEN. The same
 * page empty for two people is the finding; one person with no network is not.
 */
export function detectBlankScreen(events: ClientEventRow[], now: number, days = 3): Finding[] {
  const groups = groupBy(inWindow(events, 'blank', now, days), e => e.route || '?');
  const out: Finding[] = [];
  for (const [route, rows] of groups) {
    const people = peopleOf(rows);
    if (!people.length) continue;
    out.push({
      detector: 'blank_screen',
      key: `blank_screen:${route}`,
      title: `${route} נטען ריק אצל ${people.length} אתלטים`,
      affected: people.length,
      strength: strengthFor(people.length),
      evidence: {
        how:
          `הדפדפן מדד את המסך אחרי שהניווט נרגע ומצא אותו בלי תוכן. זו התקלה שאף אחד לא מדווח ` +
          `עליה, כי אין על המסך שום דבר לתאר. הקיבוץ הוא לפי מסך: אותו עמוד ריק אצל שני אנשים ` +
          `הוא ממצא, אדם אחד בלי רשת הוא לא.`,
        unknown: 'אם לאתלט פשוט לא היה אינטרנט באותו רגע — את זה המדידה הזאת לא יכולה להפריד.',
        athleteIds: people,
        facts: {
          'מסך': route,
          'אתלטים': people.length,
          'מופעים': rows.length,
          'גרסאות': [...new Set(rows.map(r => r.app_version || '?'))].join(', '),
        },
      },
    });
  }
  return out;
}

/**
 * ── dropped_form ── Somebody filled a form in and lost it.
 *
 * The one detector here whose signal is BEHAVIOUR rather than an error, and the
 * threshold is therefore higher: leaving a form is a normal thing to do, so a
 * single abandonment says nothing at all. What is not normal is the same form
 * being abandoned repeatedly by several different people — that is a form that
 * cannot be submitted, and the people it happened to never told anybody because
 * from the inside it looks like they changed their mind.
 */
export function detectDroppedForm(events: ClientEventRow[], now: number, days = 7): Finding[] {
  const groups = groupBy(inWindow(events, 'form_abandon', now, days), e => e.route || '?');
  const out: Finding[] = [];
  for (const [route, rows] of groups) {
    const people = peopleOf(rows);
    // Three abandonments across two people. Below that it is somebody changing
    // their mind, which is not a bug and must not be filed as one.
    if (people.length < 2 || rows.length < 3) continue;
    out.push({
      detector: 'dropped_form',
      key: `dropped_form:${route}`,
      title: `${people.length} אתלטים התחילו למלא טופס ב-${route} ולא שלחו אותו`,
      affected: people.length,
      strength: 'finding',
      evidence: {
        how:
          `הדפדפן סימן טופס שהוקלד בו וננטש בלי שליחה. לנטוש טופס זה דבר נורמלי, ולכן הרף כאן ` +
          `גבוה יותר: ${rows.length} נטישות של אותו טופס אצל ${people.length} אנשים שונים. ` +
          `תוכן השדות לא נשלח ולא נשמר — רק העובדה שהטופס ננטש.`,
        unknown: 'ייתכן שהם באמת שינו את דעתם. מה שאי אפשר לדעת מכאן הוא אם הכפתור עבד.',
        athleteIds: people,
        facts: {
          'מסך': route,
          'אתלטים': people.length,
          'נטישות': rows.length,
        },
      },
    });
  }
  return out;
}

/**
 * ── stuck_version ── The update is out and their phone is still on the old build.
 *
 * This is the detector the app's own history most asks for. `skipWaiting: false`
 * means a new service worker WAITS, and the only way to accept an update is the
 * prompt in the root layout — so an athlete who never taps it stays on an old
 * build indefinitely, reporting bugs that were fixed weeks ago and missing fixes
 * that shipped for them.
 *
 * Three boots on the stale build is the threshold, not one: right after a deploy
 * everybody is behind for a few minutes, and a single old boot is somebody who
 * simply hasn't reloaded yet. Three is a phone that keeps opening the app and
 * keeps not taking the update.
 *
 * The comparison is against the newest build actually OBSERVED, not only against
 * the server's own version, so a pass that runs mid-deploy cannot report the
 * whole club as stale.
 */
export function detectStuckVersion(
  events: ClientEventRow[],
  serverVersion: string,
  now: number,
  days = 7,
): Finding[] {
  const boots = inWindow(events, 'boot', now, days).filter(e => e.athlete_id && e.app_version);
  if (!boots.length) return [];

  let newest = serverVersion;
  for (const b of boots) if (compareVersions(b.app_version, newest) > 0) newest = b.app_version!;

  const byAthlete = groupBy(boots, e => e.athlete_id!);
  const stale: Array<{ id: string; version: string; boots: number }> = [];
  for (const [id, rows] of byAthlete) {
    const sorted = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const latest = sorted[0];
    // Still on an old build at their most recent boot, and it wasn't a one-off.
    if (compareVersions(latest.app_version, newest) >= 0) continue;
    const onOld = sorted.filter(r => compareVersions(r.app_version, newest) < 0).length;
    if (onOld < 3) continue;
    if (daysBetween(latest.created_at, now) > 2) continue;
    stale.push({ id, version: latest.app_version!, boots: onOld });
  }
  if (!stale.length) return [];

  return [{
    detector: 'stuck_version',
    key: `stuck_version:${newest}:${stale.map(s => s.id).sort().join(',')}`,
    title: `${stale.length} אתלטים פותחים את האפליקציה ונשארים על גרסה ${stale[0].version} במקום ${newest}`,
    affected: stale.length,
    strength: strengthFor(stale.length),
    evidence: {
      how:
        `הדפדפן מדווח באיזו גרסה הוא עלה. העובד (service worker) מחכה בכוונה ולא משתלט על ` +
        `הדף, ולכן הדרך היחידה לקבל עדכון היא ההודעה בראש המסך — מי שלא מאשר אותה נשאר על ` +
        `בילד ישן. הרף הוא שלוש עליות על הגרסה הישנה ולא אחת, כי מיד אחרי דיפלוי כולם מאחור ` +
        `לרגע. ההשוואה היא לגרסה החדשה ביותר שנראתה בפועל, לא רק לזו של השרת.`,
      unknown: 'מכאן אי אפשר לדעת אם הם לא רואים את ההודעה או רואים ומתעלמים.',
      athleteIds: stale.map(s => s.id),
      facts: {
        'אתלטים': stale.length,
        'גרסה חדשה': newest,
        'גרסאות תקועות': [...new Set(stale.map(s => s.version))].join(', '),
        'עליות על הישנה': stale.map(s => s.boots).join(', '),
      },
    },
  }];
}

/**
 * ── server_error ── Our own API answered 5xx, seen from where it was felt.
 *
 * Read from the CLIENT rather than from server logs, and that is the interesting
 * choice here. Vercel's logs are not queryable from inside the app, and wrapping
 * a hundred route files in a reporter would be a much larger change that still
 * would not know whether the athlete's screen recovered. A 500 nobody was waiting
 * on is a log line; a 500 that broke a page is a bug, and only the browser knows
 * which of the two it was.
 *
 * Grouped by the API path, because that is the unit somebody can go and fix.
 */
export function detectServerError(events: ClientEventRow[], now: number, days = 3): Finding[] {
  const groups = groupBy(inWindow(events, 'api_error', now, days), e => e.route || '?');
  const out: Finding[] = [];
  for (const [route, rows] of groups) {
    const people = peopleOf(rows);
    if (!people.length) continue;
    out.push({
      detector: 'server_error',
      key: `server_error:${route}`,
      title: `${route} החזיר שגיאת שרת ל-${people.length} אתלטים`,
      affected: people.length,
      strength: strengthFor(people.length),
      evidence: {
        how:
          `נמדד מהדפדפן ולא מלוגים של השרת: 500 שאף אחד לא חיכה לו הוא שורה בלוג, 500 ששבר ` +
          `מסך הוא באג, ורק הדפדפן יודע מה מהשניים זה היה. הקיבוץ הוא לפי נתיב ה-API, כי זה ` +
          `הדבר שאפשר ללכת ולתקן.`,
        athleteIds: people,
        facts: {
          'נתיב': route,
          'אתלטים': people.length,
          'קריאות שנכשלו': rows.length,
          'הודעות': [...new Set(rows.map(r => r.message || '?'))].slice(0, 3).join(' · '),
        },
      },
    });
  }
  return out;
}

/**
 * ── suspicious_pace ── A run the data says is impossible.
 *
 * The only detector that looks for data that is WRONG rather than data that is
 * missing, and the only one here that needs no new table.
 *
 * The rule is deliberately set at impossible rather than at unlikely: under
 * 2:30/km over three kilometres is faster than the world record, so it is not a
 * fast athlete, it is a bike ride logged as a run, a GPS spike, or a unit
 * confusion in an import. An unlikely-but-possible threshold would spend its life
 * accusing the fastest people in the club of cheating, which is a far worse
 * failure than missing a bad row.
 *
 * It matters because these rows are not inert: they set PRs, they win the volume
 * board, and they drag a weekly average so far off that the plan comparison
 * stops meaning anything.
 */
export function detectSuspiciousPace(activities: ActivityRow[]): Finding | null {
  const bad: Array<{ row: ActivityRow; why: string }> = [];
  for (const a of activities) {
    const distance = a.distance || 0;
    const duration = a.duration || 0;
    if (distance > 100_000) {
      bad.push({ row: a, why: `${Math.round(distance / 1000)} ק״מ בפעילות אחת` });
      continue;
    }
    // Three kilometres is where a pace stops being an artefact of rounding.
    if (distance < 3000 || duration <= 0) continue;
    const pace = duration / (distance / 1000);
    if (pace < 150) {
      const m = Math.floor(pace / 60);
      bad.push({ row: a, why: `${m}:${String(Math.round(pace % 60)).padStart(2, '0')} לק״מ` });
    }
  }
  if (!bad.length) return null;

  const people = [...new Set(bad.map(b => b.row.athlete_id))];
  return {
    detector: 'suspicious_pace',
    key: `suspicious_pace:${bad.map(b => b.row.id).sort().join(',')}`,
    title: `${bad.length} פעילויות עם נתונים בלתי אפשריים — ${bad[0].why}`,
    affected: people.length,
    strength: 'finding',
    evidence: {
      how:
        `הרף הוא בלתי אפשרי ולא לא-סביר: מתחת ל-2:30 לק״מ על שלושה ק״מ זה מהר משיא עולם, ולכן ` +
        `זה לא אתלט מהיר אלא אופניים שנרשמו כריצה, קפיצת GPS, או בלבול יחידות בייבוא. רף של ` +
        `לא-סביר היה מאשים את המהירים בקבוצה, וזו תקלה גרועה בהרבה מלפספס שורה.`,
      unknown: 'אם זו באמת פעילות אחרת שנרשמה כריצה — צריך להחליט אם למחוק או לתקן את הסוג.',
      athleteIds: people,
      facts: {
        'פעילויות': bad.length,
        'אתלטים': people.length,
        'דוגמאות': bad.slice(0, 3).map(b => b.why).join(' · '),
        'מקורות': [...new Set(bad.map(b => b.row.source || 'unknown'))].join(', '),
      },
    },
  };
}

/**
 * Drop anything that cannot name the people it affected.
 *
 * This is rule 2 enforced in one place rather than trusted to each detector: a
 * finding with `affected === 0` is not a quieter finding, it is not a finding,
 * and a finding that could only measure a trend is a weak signal.
 */
export function keepProvable(findings: Array<Finding | null>): Finding[] {
  return findings
    .filter((f): f is Finding => !!f)
    .map(f => (f.affected > 0 ? f : { ...f, strength: 'weak' as const }))
    .sort((a, b) => {
      // Findings above weak signals, then by how many people — NOT by how many
      // times it happened, which is how one athlete with an ancient phone ends
      // up outranking a bug that hit seven.
      if (a.strength !== b.strength) return a.strength === 'finding' ? -1 : 1;
      return b.affected - a.affected;
    });
}
