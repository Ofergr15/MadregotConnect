// The academy move-in board (migration plan, screens A–B): everybody who was ALREADY training in
// the academy and is moving into the app, and how far each has got. Pure — the route reads, this
// decides. Six steps, in the order they happen; a trainee is "at" the first one not done.

export const MIGRATION_STEPS = ['moved', 'joined', 'watch', 'test', 'questions', 'firstWeek'] as const;
export type MigrationStep = (typeof MIGRATION_STEPS)[number];

export interface MigrationFacts {
  /** status 'invited' = has not opened their link yet. */
  status: string | null;
  hasWatch: boolean;
  /** testStateOf(...).kind, and whether it is a test waiting for the coach. */
  test: 'ok' | 'pending' | 'otherProtocol' | 'none';
  answered: boolean;
  hasPersonalWeek: boolean;
  /** academy_joined_on — the day they were moved in. */
  movedOn: string | null;
}

export interface MigrationRow {
  /** Index into MIGRATION_STEPS of the step they are at; 6 = done. */
  at: number;
  step: MigrationStep | 'done';
  /** Whose move it is: the trainee's, the coach's (approve the test, send the week), or nobody's. */
  owner: 'trainee' | 'coach' | null;
  daysSinceMove: number | null;
  /** Their move and it has been a while: worth a reminder. */
  stuck: boolean;
}

/** A trainee's own step this long after the move is "stuck". The coach's steps are never "stuck" here — they have their own queue. */
export const STUCK_AFTER_DAYS = 5;

export function migrationRow(f: MigrationFacts, today: string): MigrationRow {
  const done: Record<MigrationStep, boolean> = {
    moved: true,
    joined: f.status !== 'invited',
    watch: f.hasWatch,
    // A test sent and waiting for the coach is past the trainee's part; the coach's part is next.
    test: f.test === 'ok',
    questions: f.answered,
    firstWeek: f.hasPersonalWeek,
  };
  const at = MIGRATION_STEPS.findIndex((s) => !done[s]);
  const step = at < 0 ? 'done' : MIGRATION_STEPS[at];
  const owner = step === 'done' ? null
    : step === 'firstWeek' || (step === 'test' && f.test === 'pending') ? 'coach'
      : 'trainee';
  const days = f.movedOn ? Math.max(0, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${f.movedOn}T12:00:00Z`)) / 86_400_000)) : null;
  return { at: at < 0 ? MIGRATION_STEPS.length : at, step, owner, daysSinceMove: days, stuck: owner === 'trainee' && days != null && days >= STUCK_AFTER_DAYS };
}

/** The counts on top of the board. */
export function migrationSummary(rows: MigrationRow[]): { done: number; onTheWay: number; stuck: number } {
  return {
    done: rows.filter((r) => r.step === 'done').length,
    stuck: rows.filter((r) => r.stuck).length,
    onTheWay: rows.filter((r) => r.step !== 'done' && !r.stuck).length,
  };
}
