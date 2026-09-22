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
 * ── WHAT'S HERE AND WHAT ISN'T ──────────────────────────────────────────────
 *
 * These five need NO new schema — they are queries over tables that already
 * exist, and they include all three of the silent failures, which are the actual
 * reason to build this. The remaining detectors from the design (browser errors,
 * blank screens, dropped forms, stuck versions) all need one new table,
 * `client_events`, and are deliberately not started: a migration written before
 * you have seen which fields you actually missed gets written twice.
 *
 * Everything in this file is PURE — it takes rows and returns findings, so each
 * rule can be tested against the shape that produced the real-world failure
 * rather than against a mock of Supabase.
 */

/** Every detector in the design, including the ones not implemented yet. */
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

/** The five that run today. The rest are listed so the board can show them as
 *  "needs a table" rather than pretending they were checked and found nothing. */
export const LIVE_DETECTORS: DetectorKey[] = [
  'garmin_silent',
  'push_orphan',
  'parse_gap',
  'duplicate_athlete',
  'phantom_activity',
];

export const PENDING_DETECTORS: DetectorKey[] = [
  'client_error',
  'blank_screen',
  'dropped_form',
  'stuck_version',
  'server_error',
  'suspicious_pace',
];

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
