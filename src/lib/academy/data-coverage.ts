// The trainee data-coverage check (GET /api/admin/trainee-data-coverage): for every academy
// member, what data we hold and what each trainee screen will show with it.
//
// Pure. The route reads the rows and builds each screen's payload with the SAME builders
// the screens use (loadTraineeToday → buildTraineeToday, buildLoadPayload, buildBodyPayload,
// lapsWhy, readReminderPref); this module only turns those payloads into one verdict per
// screen and a plain Hebrew table. It never re-decides a status, so the verdict cannot
// drift from what the trainee sees.
//
// Ofer's missing-data rule is what a verdict names: `full` (the screen has everything),
// `estimate` (a number stands on an estimate and says so), `learning` (it says how long
// until it appears), `missing` (it says what is missing and what will make it appear),
// `off` (the trainee or the club switched it off).

import type { BodyPayload, MetricPanel } from './body';
import type { DataFeed } from './data-feed';
import { isLearning, type MetricMissing } from './normal-range';
import type { LoadStatus } from './pmc';
import type { TestState } from './test-state';
import type { BodyChip, TraineeToday } from './trainee-today';
import type { LapsWhy, NoLoadReason } from './workout-extras';
import type { LoadSource } from './load';
import { isolateNumbers } from './morning-reminder';

export type VerdictState = 'full' | 'estimate' | 'learning' | 'missing' | 'off';

export interface ScreenVerdict {
  /** The mockup's screen number: 1, 2/3, 4, 5, 7, 8, 9. */
  screen: string;
  /** What on the screen: form, card, sleep, rhr, watch, laps, load, reminder, … */
  item: string;
  state: VerdictState;
  /** A stable code for the reason (`learning`, `noGarmin`, `noTest`, …). */
  code: string;
  /** The Hebrew sentence: what is missing and what will make it appear. */
  he: string;
}

export type PlanSource = 'own' | 'group' | 'none';

/** The raw numbers per trainee (no credential, no health value beyond counts and dates). */
export interface CoverageData {
  athleteId: string;
  name: string;
  status: string | null;
  garmin: { linked: boolean; lastSyncAt: string | null; failedAt: string | null };
  strava: { linked: boolean; lastSyncAt: string | null; failedAt: string | null };
  runFeed: DataFeed['kind'];
  nightFeed: DataFeed['kind'];
  runs42: { total: number; withHr: number; withLaps: number; stravaOnly: number; manual: number };
  latestRun: string | null;
  test: { kind: TestState['kind']; date: string | null; old: boolean; threshold: boolean; thresholdSec: number | null };
  band: { number: number | null; name: string | null } | null;
  maxHr: { fromRuns: number | null; profile: number | null };
  wellness30: { sleepNights: number; rhrMornings: number; latest: string | null };
  planThisWeek: PlanSource;
  pushSubscriptions: number;
  reminder: { enabled: boolean; time: string; muted: boolean; explicit: boolean };
}

export interface CoverageRow extends CoverageData {
  screens: ScreenVerdict[];
}

const v = (screen: string, item: string, state: VerdictState, code: string, he: string): ScreenVerdict => ({ screen, item, state, code, he });

const providerHe = (p: 'garmin' | 'strava') => (p === 'garmin' ? 'Garmin' : 'Strava');

/** A load status (pmc.ts LoadStatus, or the home's form which carries the same kinds). */
export function loadStatusVerdict(
  screen: string,
  item: string,
  status: LoadStatus | TraineeToday['form'],
  opts: { hrBasis?: boolean } = {},
): ScreenVerdict {
  const kind = 'kind' in status ? status.kind : status.status;
  switch (kind) {
    case 'ok':
      return opts.hrBasis
        ? v(screen, item, 'estimate', 'hrEstimate', 'מספר לפי הערכת דופק (אין טסט). טסט 30 דק׳ יהפוך אותו למדויק')
        : v(screen, item, 'full', 'ok', 'מלא');
    case 'learning': {
      const s = status as { daysLeft: number; cause?: 'new' | 'unpriced' };
      return s.cause === 'unpriced'
        ? v(screen, item, 'learning', 'learningUnpriced', `לומד אותך עוד ${s.daysLeft} ימים (ריצות ישנות לא תומחרו: לפני הטסט ובלי דופק מנוחה מהשעון)`)
        : v(screen, item, 'learning', 'learning', `לומד אותך עוד ${s.daysLeft} ימים`);
    }
    case 'insufficient':
      return v(screen, item, 'missing', 'insufficient', 'אין מספיק נתונים לחישוב כושר. צריך טסט, או ריצות עם דופק');
    case 'computing':
      return v(screen, item, 'learning', 'computing', `מחשב עומס ל־${(status as { pending: number }).pending} ריצות. יופיע אחרי הפתיחה הבאה`);
    case 'noFeed': {
      const s = status as { feed: 'failed' | 'stale'; provider: 'garmin' | 'strava'; days: number | null };
      return s.feed === 'failed'
        ? v(screen, item, 'missing', 'feedFailed', `החיבור ל־${providerHe(s.provider)} נכשל. צריך לחבר מחדש בפרופיל`)
        : v(screen, item, 'missing', 'feedStale', `לא הגיעו נתונים מ־${providerHe(s.provider)} ${s.days ?? '?'} ימים. צריך לסנכרן את השעון`);
    }
    default:
      return v(screen, item, 'missing', String(kind), 'לא ידוע');
  }
}

/** Why a sleep or RHR value has no judged verdict (normal-range.ts MetricMissing). */
export function metricMissingVerdict(screen: string, item: 'sleep' | 'rhr', missing: MetricMissing): ScreenVerdict {
  const what = item === 'sleep' ? 'שינה' : 'דופק מנוחה';
  switch (missing.reason) {
    case 'noGarmin':
      return v(screen, item, 'missing', 'noGarmin', 'שינה ודופק מנוחה מגיעים רק מגרמין. בלי שעון גרמין מחובר, אין נתוני לילה');
    case 'feed':
      return missing.feed === 'failed'
        ? v(screen, item, 'missing', 'feedFailed', 'החיבור לגרמין נותק. מתחברים מחדש בפרופיל')
        : v(screen, item, 'missing', 'feedStale', `לא התקבלו נתונים מגרמין ${missing.days ?? '?'} ימים`);
    case 'neverWorn':
      return v(screen, item, 'missing', 'neverWorn', 'אין נתוני שינה ודופק מהשעון. צריך לישון עם השעון');
    case 'notMeasured':
      return v(screen, item, 'missing', 'notMeasured', `השעון לא מודד ${what}, או שלא נלבש בלילה`);
    case 'old':
      return v(screen, item, 'missing', 'old', `הנתון האחרון מ־${missing.date}. יתעדכן כשהשעון יסונכרן`);
    case 'partial':
      return v(screen, item, 'learning', 'partial', `הלילה נקלט חלקית (${missing.date}). יתעדכן בהמשך היום`);
    default:
      return v(screen, item, 'missing', 'unknown', 'לא ידוע');
  }
}

/** The home's chip slot (trainee-today.ts bodyChips). */
export function chipVerdict(item: 'sleep' | 'rhr', chip: BodyChip | null, missing: MetricMissing | null): ScreenVerdict {
  if (missing) return metricMissingVerdict('1', item, missing);
  if (!chip) return v('1', item, 'missing', 'none', 'אין נתון');
  if (chip.learning != null) return v('1', item, 'learning', 'learning', `לומד אותך, עוד ${chip.learning} לילות`);
  return v('1', item, 'full', 'ok', 'מלא');
}

/** Screen 8's panel (body.ts). */
export function panelVerdict(item: 'sleep' | 'rhr', panel: MetricPanel): ScreenVerdict {
  if (panel.missing) return metricMissingVerdict('8', item, panel.missing);
  if (isLearning(panel.range)) return v('8', item, 'learning', 'learning', `לומד אותך, עוד ${panel.range.learning} לילות`);
  if (!panel.latest) return v('8', item, 'missing', 'none', 'אין נתון');
  return v('8', item, 'full', 'ok', 'מלא');
}

/** The test line a no-test screen prints instead of the trainee's own pace. */
export function testVerdict(screen: string, item: string, test: TestState): ScreenVerdict {
  switch (test.kind) {
    case 'pending':
      return v(screen, item, 'missing', 'testPending', `הטסט מ־${test.date} ממתין לאישור המאמן. אחריו יופיעו קצבים`);
    case 'otherProtocol':
      return v(screen, item, 'missing', 'testOther', 'יש רק טסט 2000 מ׳. צריך טסט 30 דק׳ כדי לחשב קצב');
    case 'none':
      return v(screen, item, 'missing', 'noTest', 'צריך טסט כדי לחשב קצב ועומס');
    default:
      return test.old
        ? v(screen, item, 'full', 'oldTest', `מלא. הטסט מ־${test.date} ישן, כדאי טסט חדש`)
        : v(screen, item, 'full', 'ok', 'מלא');
  }
}

/** Screen 1/4's card: the day, and whether its paces are the trainee's own. */
export function cardVerdict(screen: '1' | '4', today: TraineeToday): ScreenVerdict {
  if (today.dayState === 'noPlan') return v(screen, 'card', 'missing', 'noPlan', 'אין תוכנית לשבוע הזה. תופיע כשהמאמן יפרסם');
  if (today.dayState === 'rest') return v(screen, 'card', 'full', 'rest', 'יום מנוחה');
  // A card without the trainee's own paces (paceBasis 'none') is exactly a test that is not 'ok'.
  return testVerdict(screen, 'card', today.test);
}

export function watchVerdict(today: TraineeToday): ScreenVerdict {
  return today.canWatch
    ? v('4', 'watch', 'full', 'ok', 'אפשר לשלוח לשעון')
    : v('4', 'watch', 'missing', 'noWatch', 'האימון לא יישלח לשעון: אין Garmin מחובר');
}

export interface LatestRun {
  date: string;
  lapsWhy: LapsWhy | null;
  /** Its load row (load-server): null when the run has no row in the window. */
  source: LoadSource | null;
  noLoad: NoLoadReason | null;
}

/** Screen 5 for the newest run: its laps and its ⚡. */
export function afterVerdicts(run: LatestRun | null): ScreenVerdict[] {
  if (!run) return [v('5', 'run', 'missing', 'noRuns', 'אין ריצות ב־42 הימים האחרונים')];
  const laps: Record<LapsWhy, ScreenVerdict> = {
    manual: v('5', 'laps', 'missing', 'manual', 'ריצה ידנית: אין הקפות'),
    stravaPending: v('5', 'laps', 'missing', 'stravaPending', 'ההקפות עוד לא הגיעו מסטרבה'),
    autoLapOff: v('5', 'laps', 'missing', 'autoLapOff', 'הקפה אחת: Auto Lap כבוי בשעון'),
    unknown: v('5', 'laps', 'missing', 'unknown', 'אין הקפות'),
  };
  const out = [run.lapsWhy ? laps[run.lapsWhy] : v('5', 'laps', 'full', 'ok', 'מלא')];
  if (run.source === 'none') {
    out.push(run.noLoad === 'hrLearning'
      ? v('5', 'load', 'learning', 'hrLearning', 'העומס לא חושב: בלי טסט, ההערכה לפי דופק מתחילה אחרי 3 ריצות עם דופק')
      : v('5', 'load', 'missing', 'noHr', 'העומס לא חושב: צריך טסט, או ריצה עם דופק'));
  } else if (run.source === 'pace_avg') {
    out.push(v('5', 'load', 'estimate', 'paceAvg', '⚡ הערכה לפי קצב ממוצע (בלי הקפות)'));
  } else if (run.source === 'hr') {
    out.push(v('5', 'load', 'estimate', 'hr', '⚡ הערכה לפי דופק'));
  } else if (run.source === 'pace') {
    out.push(v('5', 'load', 'full', 'ok', 'מלא'));
  } else {
    out.push(v('5', 'load', 'learning', 'noRow', 'הריצה עוד לא תומחרה. תתומחר בפתיחה הבאה'));
  }
  return out;
}

/** Screens 2/3: the week's plan, and the planned ⚡ (which needs a threshold). */
export function weekVerdicts(plan: PlanSource, threshold: boolean, status: LoadStatus): ScreenVerdict[] {
  const out: ScreenVerdict[] = [];
  out.push(plan === 'none'
    ? v('2', 'plan', 'missing', 'noPlan', 'אין תוכנית לשבוע הזה. תופיע כשהמאמן יפרסם')
    : v('2', 'plan', 'full', plan, plan === 'own' ? 'תוכנית אישית' : 'תוכנית הקבוצה'));
  if (!threshold) out.push(v('2', 'plannedLoad', 'missing', 'noTest', '⚡ מתוכנן חסר: צריך טסט כדי לחשב עומס'));
  out.push(loadStatusVerdict('2', 'doneLoad', status));
  return out;
}

export function reminderVerdict(r: CoverageData['reminder'], subscriptions: number): ScreenVerdict {
  if (!r.enabled) return v('9', 'reminder', 'off', 'disabled', r.explicit ? 'התזכורת כבויה (המתאמן כיבה)' : 'התזכורת כבויה (ברירת מחדל עד שהדגל יופעל)');
  if (r.muted) return v('9', 'reminder', 'off', 'muted', 'התראות האימונים מושתקות');
  if (subscriptions === 0) return v('9', 'reminder', 'missing', 'noSubscription', 'אין מכשיר רשום להתראות. צריך לאשר התראות באפליקציה');
  return v('9', 'reminder', 'full', 'ok', `תזכורת ב־${r.time}`);
}

/** Every screen's verdict for one trainee, from the payloads the screens themselves get. */
export function screenVerdicts(input: {
  today: TraineeToday;
  loadStatus: LoadStatus;
  body: BodyPayload;
  plan: PlanSource;
  threshold: boolean;
  latestRun: LatestRun | null;
  reminder: CoverageData['reminder'];
  subscriptions: number;
}): ScreenVerdict[] {
  const { today } = input;
  return [
    cardVerdict('1', today),
    loadStatusVerdict('1', 'form', today.form, { hrBasis: today.form.status === 'ok' && today.form.basis === 'hr' }),
    chipVerdict('sleep', today.body.sleep, today.body.missing.sleep),
    chipVerdict('rhr', today.body.rhr, today.body.missing.rhr),
    ...weekVerdicts(input.plan, input.threshold, input.loadStatus),
    cardVerdict('4', today),
    watchVerdict(today),
    ...afterVerdicts(input.latestRun),
    loadStatusVerdict('7', 'load', input.loadStatus),
    panelVerdict('sleep', input.body.sleep),
    panelVerdict('rhr', input.body.rhr),
    reminderVerdict(input.reminder, input.subscriptions),
  ];
}

// ── The plain Hebrew table (?format=text) ─────────────────────────────────────────────

const MARK: Record<VerdictState, string> = { full: '✓', estimate: '≈', learning: '…', missing: '✗', off: '–' };
const STATE_HE: Record<VerdictState, string> = { full: 'מלא', estimate: 'הערכה', learning: 'לומד', missing: 'חסר', off: 'כבוי' };
const RLM = '‏';

const dd = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : '—');
const yn = (b: boolean) => (b ? 'כן' : 'לא');
const provider = (p: CoverageData['garmin']) => (!p.linked ? 'לא' : p.failedAt && (!p.lastSyncAt || p.failedAt >= p.lastSyncAt) ? `נכשל ${dd(p.failedAt.slice(0, 10))}` : `כן ${dd(p.lastSyncAt?.slice(0, 10) ?? null)}`);
const planHe: Record<PlanSource, string> = { own: 'אישית', group: 'קבוצה', none: 'אין' };

/** Every number run isolated LTR, each line opened right-to-left. */
const line = (cells: string[]) => RLM + isolateNumbers(cells.join(' | '));

/** The column order of the screens table: one cell per screen/item. */
export const SCREEN_COLUMNS: Array<{ screen: string; item: string; he: string }> = [
  { screen: '1', item: 'card', he: '1 כרטיס' },
  { screen: '1', item: 'form', he: '1 כושר' },
  { screen: '1', item: 'sleep', he: '1 שינה' },
  { screen: '1', item: 'rhr', he: '1 דופק' },
  { screen: '2', item: 'plan', he: '2 תוכנית' },
  { screen: '2', item: 'plannedLoad', he: '2 ⚡ מתוכנן' },
  { screen: '4', item: 'watch', he: '4 שעון' },
  { screen: '5', item: 'laps', he: '5 הקפות' },
  { screen: '5', item: 'load', he: '5 ⚡' },
  { screen: '7', item: 'load', he: '7 התקדמות' },
  { screen: '8', item: 'sleep', he: '8 שינה' },
  { screen: '8', item: 'rhr', he: '8 דופק' },
  { screen: '9', item: 'reminder', he: '9 תזכורת' },
];

export function coverageText(rows: CoverageRow[], meta: { today: string; generatedAt: string }): string {
  const out: string[] = [];
  out.push(`${RLM}בדיקת כיסוי נתונים — מתאמני האקדמיה (${rows.length}) — ${isolateNumbers(dd(meta.today))}`);
  out.push(`${RLM}מקרא: ✓ מלא · ≈ הערכה · … לומד · ✗ חסר · – כבוי`);
  out.push('');
  out.push(`${RLM}נתונים`);
  out.push(line(['שם', 'Garmin', 'Strava', 'ריצות 42 יום', 'עם דופק', 'עם הקפות', 'סטרבה בלבד', 'ידני', 'טסט', 'סף', 'דבוקה', 'דופק מקס׳', 'לילות שינה 30', 'בקרי דופק 30', 'אחרון', 'תוכנית', 'מכשירים', 'תזכורת']));
  for (const r of rows) {
    out.push(line([
      r.name,
      provider(r.garmin),
      provider(r.strava),
      String(r.runs42.total),
      String(r.runs42.withHr),
      String(r.runs42.withLaps),
      String(r.runs42.stravaOnly),
      String(r.runs42.manual),
      r.test.date ? `${dd(r.test.date)}${r.test.kind === 'pending' ? ' ממתין' : r.test.kind === 'otherProtocol' ? ' 2000' : r.test.old ? ' ישן' : ''}` : 'אין',
      yn(r.test.threshold),
      r.band ? String(r.band.number ?? r.band.name ?? '?') : 'אין',
      r.maxHr.fromRuns != null ? String(r.maxHr.fromRuns) : r.maxHr.profile != null ? `${r.maxHr.profile} (פרופיל)` : 'אין',
      String(r.wellness30.sleepNights),
      String(r.wellness30.rhrMornings),
      dd(r.wellness30.latest),
      planHe[r.planThisWeek],
      String(r.pushSubscriptions),
      r.reminder.enabled ? `${r.reminder.time}${r.reminder.muted ? ' מושתק' : ''}` : 'כבויה',
    ]));
  }
  out.push('');
  out.push(`${RLM}מה כל מתאמן יראה`);
  out.push(line(['שם', ...SCREEN_COLUMNS.map(c => c.he)]));
  for (const r of rows) {
    // A '*' verdict (not active, or the build failed) stands for every screen.
    const all = r.screens.find(x => x.screen === '*');
    out.push(line([r.name, ...SCREEN_COLUMNS.map(c => {
      const s = all ?? r.screens.find(x => x.screen === c.screen && x.item === c.item);
      return s ? MARK[s.state] : ' ';
    })]));
  }
  out.push('');
  out.push(`${RLM}מה חסר ומה יגרום לזה להופיע`);
  for (const r of rows) {
    const gaps = r.screens.filter(s => s.state !== 'full');
    if (!gaps.length) continue;
    out.push(`${RLM}${r.name}:`);
    for (const s of gaps) out.push(`${RLM}  • ${isolateNumbers(`${s.screen}`)} ${s.item}: ${STATE_HE[s.state]} — ${isolateNumbers(s.he)}`);
  }
  out.push('');
  out.push(`${RLM}נוצר ${isolateNumbers(meta.generatedAt)} · קריאה בלבד, לא נכתב דבר`);
  return out.join('\n') + '\n';
}
