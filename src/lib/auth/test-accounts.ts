/**
 * The lab's sign-in accounts (POST /api/dev/test-signin). Real rows in the prod
 * database, used by every localhost verification run — so their client events are
 * ours, not a member's. The bug detectors drop them: #120 was the Test Runner
 * "stuck on 2.41.176" because a lab run had an old build open.
 */
export const TEST_RUNNER_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
export const TEST_COACH_ID = 'aaaaaaaa-0000-0000-0000-000000000002';
export const TEST_ACCOUNT_IDS: ReadonlySet<string> = new Set([TEST_RUNNER_ID, TEST_COACH_ID]);
