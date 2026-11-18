// ── "מדריך לאקדמיה": the trainee's day-one guide (/dashboard/academy/guide) ─────────────
//
// Beyond installing: where the plan is, where the coach's messages are, how a workout gets
// feedback, the watch, the week. Two sets of steps, because a trainee sees one of two
// academies: the trainee experience v2 (every academy-only trainee, lib/nav-items.ts
// `traineeV2`) — tabs "היום · לוח · התקדמות", profile under "עוד" — or the classic one
// (a club member who is also in the academy) — the "אקדמיה" tab, "האקדמיה שלי".
//
// Every label the guide shows is the REAL screen's label, never retyped: a `msg` ref is
// rendered through next-intl from the very key the screen uses, and a `lit` ref is a
// Hebrew literal hardcoded in a screen's source, which academyGuide.test.ts reads back
// out of that file. Rename a tab or a button and the test fails.

export type GuideLabel =
  | { msg: string; values?: Record<string, string> }
  /**
   * Hardcoded in `file` (relative to the repo root). `lit` is what the guide shows (the coach's
   * name stood in by "המאמן"); `check` is the exact source text the test finds in `file`.
   */
  | { lit: string; check: string; file: string };

export interface GuideStep {
  id: string;
  /** lucide icon name, mapped in the page. */
  icon: 'sun' | 'calendar' | 'message' | 'feel' | 'watch' | 'progress' | 'graduation' | 'bell';
  /** academyGuide.steps.<id>.title / .body */
  path: GuideLabel[];
  href: string;
}

const MY_VIEW = 'src/components/academy/AcademyMyView.tsx';
const PLAN_SHEET = 'src/components/academy/WorkoutPlanSheet.tsx';
const COACH = { name: 'המאמן' };

/** Trainee experience v2: the academy-only trainee. */
export const GUIDE_V2: GuideStep[] = [
  { id: 'today', icon: 'sun', href: '/dashboard', path: [{ msg: 'nav.dashboard' }, { msg: 'trainee.home.open' }] },
  { id: 'board', icon: 'calendar', href: '/dashboard/academy', path: [{ msg: 'nav.board' }, { msg: 'trainee.week.view.week' }, { msg: 'trainee.week.view.month' }] },
  { id: 'coach', icon: 'message', href: '/dashboard/academy?thread=mine', path: [{ msg: 'nav.dashboard' }, { lit: '💬', check: '💬', file: 'src/components/trainee/TraineeToday.tsx' }, { msg: 'trainee.home.chatWith', values: COACH }] },
  { id: 'feel', icon: 'feel', href: '/dashboard/academy', path: [{ msg: 'nav.board' }, { msg: 'trainee.workout.feelButton' }, { msg: 'trainee.feel.effort' }, { msg: 'trainee.feel.pain' }] },
  { id: 'watch', icon: 'watch', href: '/dashboard/profile?connectGarmin=1', path: [{ msg: 'nav.profile' }, { msg: 'profile.tabSettings' }, { msg: 'profile.connections' }, { msg: 'profile.activityDataSource' }] },
  { id: 'progress', icon: 'progress', href: '/dashboard/academy/progress', path: [{ msg: 'nav.progress' }] },
];

/** The classic academy: a club member who also trains in the academy. */
export const GUIDE_V1: GuideStep[] = [
  { id: 'home', icon: 'graduation', href: '/dashboard/academy', path: [{ msg: 'nav.academy' }, { lit: 'האקדמיה שלי', check: '>האקדמיה שלי<', file: MY_VIEW }] },
  { id: 'week', icon: 'calendar', href: '/dashboard/academy/week', path: [{ msg: 'nav.academy' }, { msg: 'academy.openWeek' }] },
  { id: 'coachV1', icon: 'message', href: '/dashboard/academy?thread=mine', path: [{ msg: 'nav.academy' }, { lit: 'השיחה עם המאמן', check: '`השיחה עם ${coachFirst}`', file: MY_VIEW }] },
  { id: 'feedbackV1', icon: 'feel', href: '/dashboard/academy', path: [{ msg: 'nav.academy' }, { lit: 'לכתוב למאמן', check: 'לכתוב {toCoach}', file: PLAN_SHEET }, { lit: 'לענות למאמן', check: 'לענות {toCoach}', file: PLAN_SHEET }] },
  { id: 'watchV1', icon: 'watch', href: '/dashboard/profile?connectGarmin=1', path: [{ msg: 'nav.profile' }, { msg: 'profile.tabSettings' }, { msg: 'profile.connections' }, { msg: 'profile.activityDataSource' }] },
  { id: 'appV1', icon: 'bell', href: '/dashboard/profile?install=1', path: [{ msg: 'nav.profile' }, { msg: 'profile.tabSettings' }, { msg: 'profile.installApp' }, { msg: 'profile.notificationPrefs' }] },
];

export const ACADEMY_GUIDE_PATH = '/dashboard/academy/guide';

export function guideSteps(traineeV2: boolean): GuideStep[] {
  return traineeV2 ? GUIDE_V2 : GUIDE_V1;
}
