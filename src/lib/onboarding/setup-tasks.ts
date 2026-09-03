// ═════════════════════════════════════════════════════════════════════════════
// Profile-setup completeness — the % behind the setup card on /dashboard/profile.
//
// Pure and shared: the API route feeds it a row, the client renders what comes
// back. Nothing here reads the network or the DOM, so the scoring rules are
// testable on their own (src/__tests__/setupTasks.test.ts).
//
// WHY THIS EXISTS: signup only ever asks for name, email, an optional pace group
// and Garmin credentials. Every other field on the athlete row has simply never
// been requested of anyone — measured across all 28 club members, 26 have no
// phone, no birth date and no sizes, and 16 have no photo. Nothing is broken;
// nobody was ever asked.
// ═════════════════════════════════════════════════════════════════════════════

/** Tasks that count toward the percentage — things the athlete can act on. */
export const SETUP_TASK_KEYS = ['watch', 'photo', 'personalInfo', 'sizes', 'notifications'] as const;
export type SetupTaskKey = (typeof SETUP_TASK_KEYS)[number];

/**
 * Shown on the checklist but NOT scored.
 *
 * `paceGroup` is the coach's call, not the athlete's — 9 of 28 members are
 * unassigned, and holding someone's 100% hostage to a decision they can't make
 * turns the card into a nag about somebody else's task.
 *
 * `activeShoe` is scored out because literally 0 of 28 members have one: keeping
 * it in the denominator would cap the entire club below 100% forever, which is
 * how a progress indicator teaches people to ignore it.
 */
export const SETUP_INFO_KEYS = ['paceGroup', 'activeShoe'] as const;
export type SetupInfoKey = (typeof SETUP_INFO_KEYS)[number];

/** The athlete columns the score reads, already normalised by the API route. */
export interface SetupInput {
  /** True only when there are real credentials — see hasWorkingSource below. */
  hasGarminAuth: boolean;
  hasStravaAuth: boolean;
  /** The DECLARED source. Never sufficient on its own; see below. */
  dataSource: string | null;
  avatarUrl: string | null;
  phone: string | null;
  birthDate: string | null;
  gender: string | null;
  shirtSize: string | null;
  shoeSize: string | null;
  /** Rows in push_subscriptions for this athlete. */
  pushSubscriptions: number;
  groupName: string | null;
  hasActiveShoe: boolean;
}

export interface SetupTask {
  key: SetupTaskKey;
  done: boolean;
  /** Optional render hints for the row's sublabel. */
  meta?: { source?: string; filled?: number; total?: number };
}

export interface SetupInfoItem {
  key: SetupInfoKey;
  done: boolean;
  /** `true` = waiting on somebody else, so it reads as pending, not as a task. */
  waiting: boolean;
  meta?: { groupName?: string };
}

export interface SetupState {
  tasks: SetupTask[];
  info: SetupInfoItem[];
  doneCount: number;
  totalCount: number;
  /** 0–100, rounded. */
  pct: number;
  /** First unfinished task, for the card's "next up" line. null when finished. */
  nextKey: SetupTaskKey | null;
  /** Every scored task done — the card may show its celebration. */
  allDone: boolean;
}

/**
 * Is the activity feed actually going to sync?
 *
 * `data_source` is NOT the answer, and this is the trap worth spelling out: all
 * 28 club members have `data_source` set (24 garmin, 4 strava) but only 17 have
 * credentials behind it. Scoring on `data_source` would tell the other 11 that
 * they're connected while nothing syncs. Only the credential columns count.
 */
export function hasWorkingSource(input: Pick<SetupInput, 'hasGarminAuth' | 'hasStravaAuth'>): boolean {
  return input.hasGarminAuth || input.hasStravaAuth;
}

function filled(...values: Array<string | null | undefined>): number {
  return values.filter((v) => !!v && String(v).trim() !== '').length;
}

export function computeSetupState(input: SetupInput): SetupState {
  const connected = hasWorkingSource(input);
  const personalFilled = filled(input.phone, input.birthDate, input.gender);
  const sizesFilled = filled(input.shirtSize, input.shoeSize);

  const tasks: SetupTask[] = [
    {
      key: 'watch',
      done: connected,
      // The declared source rides along either way: when it's set but there are
      // no credentials, that IS the useful thing to say ("Garmin, not synced").
      meta: input.dataSource ? { source: input.dataSource } : undefined,
    },
    { key: 'photo', done: !!input.avatarUrl },
    { key: 'personalInfo', done: personalFilled === 3, meta: { filled: personalFilled, total: 3 } },
    { key: 'sizes', done: sizesFilled === 2, meta: { filled: sizesFilled, total: 2 } },
    // A live subscription row, not the notification_prefs toggles: prefs default
    // to on for everyone, so they say nothing about whether the browser ever
    // granted permission. Worth knowing that a row still isn't proof of
    // DELIVERY either — Apple returns 201 for endpoints it has silently
    // orphaned — so this claims "enabled", never "working".
    { key: 'notifications', done: input.pushSubscriptions > 0 },
  ];

  const info: SetupInfoItem[] = [
    {
      key: 'paceGroup',
      done: !!input.groupName,
      waiting: !input.groupName,
      meta: input.groupName ? { groupName: input.groupName } : undefined,
    },
    { key: 'activeShoe', done: input.hasActiveShoe, waiting: false },
  ];

  const doneCount = tasks.filter((t) => t.done).length;
  const totalCount = tasks.length;

  return {
    tasks,
    info,
    doneCount,
    totalCount,
    pct: Math.round((doneCount / totalCount) * 100),
    nextKey: tasks.find((t) => !t.done)?.key ?? null,
    allDone: doneCount === totalCount,
  };
}
