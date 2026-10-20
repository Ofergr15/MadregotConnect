/**
 * The admin's People list (#71, phase 2): every member with ONE state, and the
 * four questions an admin filters by — who is waiting on me, who never finished
 * setting the app up, who has no watch connected, and who has gone quiet.
 *
 * Pure so the state order can be pinned by tests; /api/admin/people does the
 * reads and hands the facts in.
 */

export type PersonState = 'waiting' | 'paused' | 'noWatch' | 'setup' | 'silent' | 'active';
export type PeopleFilter = 'all' | 'waiting' | 'setup' | 'noWatch' | 'silent' | 'browser' | 'noPush';

// 'browser': opens Madregot in a browser tab, not the installed app — on iOS that
// means no notifications, so these are the members to send the install guide.
// 'noPush': has devices, but none shows notifications (lib/push-health, #108).
export const PEOPLE_FILTERS: PeopleFilter[] = ['all', 'waiting', 'setup', 'noWatch', 'silent', 'browser', 'noPush'];

/** Same window as the home tile "no run in 7 days", so the two numbers agree. */
export const SILENT_DAYS = 7;

export interface Person {
  id: string;
  name: string;
  role: string;
  groupId?: string | null;
  pendingGroupId?: string | null;
  pendingFrom?: string | null;
  groupName: string | null;
  /** athletes.status: active | invited | paused | … */
  status: string;
  approved: boolean;
  source: 'garmin' | 'strava' | null;
  /** Latest run's Israel calendar date, null when none in the read window. */
  lastRunDay: string | null;
  lastSeenAt: string | null;
  joinedAt: string | null;
  setupDone: boolean;
  pushDevices: number;
  /** Newest push_subscriptions.last_success_at across the member's devices. */
  lastPushAt: string | null;
  /** Devices registered, none showed a notification in 7 days, and some were sent (lib/push-health). */
  pushDead?: boolean;
  /** How they last opened the app in 30 days: the home-screen install, a browser tab, or unknown. */
  openedAs?: 'app' | 'browser' | null;
  openedAt?: string | null;
  isAcademy?: boolean;
  /** הגרעין (athletes.is_core_runner). */
  isCore?: boolean;
  avatarUrl?: string | null;
  extraRoles?: string[];
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

export function isSilent(p: Person, today: string): boolean {
  return !p.lastRunDay || daysBetween(p.lastRunDay, today) >= SILENT_DAYS;
}

/**
 * The ONE pill a row shows, most-actionable first: somebody waiting for approval
 * outranks everything, because nothing else about them can happen until then. A
 * missing watch comes before an unfinished setup because no watch means no data
 * at all, and "silent" last because it's only meaningful for somebody set up.
 */
export function personState(p: Person, today: string): PersonState {
  if (!p.approved || p.status === 'invited') return 'waiting';
  if (p.status === 'paused') return 'paused';
  if (!p.source) return 'noWatch';
  if (!p.setupDone) return 'setup';
  if (isSilent(p, today)) return 'silent';
  return 'active';
}

/**
 * Filters are facts, not the pill: a member with no watch who also never
 * finished setup shows under both chips, since both are true and each chip is
 * answering its own question. Paused members only appear under "all".
 */
export function matchesFilter(p: Person, filter: PeopleFilter, today: string): boolean {
  const waiting = !p.approved || p.status === 'invited';
  const live = !waiting && p.status !== 'paused';
  switch (filter) {
    case 'all': return true;
    case 'waiting': return waiting;
    case 'setup': return live && !p.setupDone;
    case 'noWatch': return live && !p.source;
    case 'silent': return live && isSilent(p, today);
    case 'browser': return live && p.openedAs === 'browser';
    case 'noPush': return live && !!p.pushDead;
  }
}

export function filterCounts(people: Person[], today: string): Record<PeopleFilter, number> {
  const out = { all: 0, waiting: 0, setup: 0, noWatch: 0, silent: 0, browser: 0, noPush: 0 } as Record<PeopleFilter, number>;
  for (const p of people) for (const f of PEOPLE_FILTERS) if (matchesFilter(p, f, today)) out[f]++;
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// The People WALL (2026-10-20, Ofer picked "קיר פנים" of three mockups): who is in
// each area, with each face carrying three signals that need no tap — touched the
// app, watch connected, ran lately. Pure, so the areas and thresholds are tested
// (src/__tests__/peopleWall.test.ts).
// ═════════════════════════════════════════════════════════════════════════════

const STAFF_ROLES_SET = new Set(['coach', 'admin', 'academy_coach']);

export const isWaitingPerson = (p: Person) => !p.approved || p.status === 'invited';
export const isStaffPerson = (p: Person) => STAFF_ROLES_SET.has(p.role) || (p.extraRoles ?? []).length > 0;

/** ok = fine (grey), bad = needs attention (red), off = not relevant yet (faded). */
export type Signal = 'ok' | 'bad' | 'off';
export interface FaceSignals {
  app: Signal;
  watch: Signal;
  run: Signal;
  push: Signal;
  /** Days since they last opened the app / last ran; null = never / none in the window. */
  appDays: number | null;
  runDays: number | null;
  /** Never opened the app, or still waiting: the face is drawn faded. */
  faded: boolean;
}

export function faceSignals(p: Person, today: string): FaceSignals {
  const waiting = isWaitingPerson(p);
  const appDays = p.lastSeenAt ? Math.max(0, daysBetween(p.lastSeenAt.slice(0, 10), today)) : null;
  const runDays = p.lastRunDay ? Math.max(0, daysBetween(p.lastRunDay, today)) : null;
  return {
    app: waiting ? 'off' : appDays === null || appDays >= SILENT_DAYS ? 'bad' : 'ok',
    watch: waiting && !p.source ? 'off' : p.source ? 'ok' : 'bad',
    run: runDays === null ? (waiting ? 'off' : 'bad') : runDays >= SILENT_DAYS ? 'bad' : 'ok',
    push: waiting ? 'off' : p.pushDevices === 0 || p.pushDead ? 'bad' : 'ok',
    appDays,
    runDays,
    faded: waiting || !p.lastSeenAt,
  };
}

export interface WallGroup { id: string; name: string }
export interface WallArea { key: string; label: string; test: (p: Person) => boolean }

/**
 * The areas, in the order the filter row and the sections show them: each pack,
 * the academy, הגרעין, the staff, who is waiting, and who has no pack. A person
 * can be in several (a coach who is also in pack 2); the sections of "all" show
 * each person once, in the first area that holds them.
 */
export function wallAreas(groups: WallGroup[], packLabel: (n: number, name: string) => string, labels: { academy: string; core: string; staff: string; waiting: string; noPack: string }): WallArea[] {
  return [
    ...groups.map((g, i) => ({ key: `pack:${g.id}`, label: packLabel(i + 1, g.name), test: (p: Person) => p.groupId === g.id && !isWaitingPerson(p) })),
    { key: 'academy', label: labels.academy, test: (p: Person) => !!p.isAcademy },
    { key: 'core', label: labels.core, test: (p: Person) => !!p.isCore },
    { key: 'staff', label: labels.staff, test: isStaffPerson },
    { key: 'waiting', label: labels.waiting, test: isWaitingPerson },
    {
      key: 'noPack', label: labels.noPack,
      test: (p: Person) => !isWaitingPerson(p) && !p.isAcademy && !isStaffPerson(p) && !groups.some((g) => g.id === p.groupId),
    },
  ];
}

/** The wall's sections for a filter: one area, or every area with each person once. */
export function wallSections(people: Person[], areas: WallArea[], area: string): Array<{ area: WallArea; people: Person[] }> {
  const byName = (a: Person, b: Person) => a.name.localeCompare(b.name);
  if (area !== 'all') {
    const one = areas.find((a) => a.key === area);
    return one ? [{ area: one, people: people.filter(one.test).sort(byName) }] : [];
  }
  const used = new Set<string>();
  const out: Array<{ area: WallArea; people: Person[] }> = [];
  for (const a of areas) {
    const list = people.filter((p) => a.test(p) && !used.has(p.id)).sort(byName);
    list.forEach((p) => used.add(p.id));
    if (list.length) out.push({ area: a, people: list });
  }
  // Every person is in one area at least: a pack, the academy, the staff, waiting,
  // or "no pack" (which is everybody else) — so nobody falls off the wall.
  return out;
}
