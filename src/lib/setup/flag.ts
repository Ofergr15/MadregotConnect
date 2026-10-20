// The one switch for the required setup (components/setup/SetupGate). Off: only the
// super user's preview (?setup=1) sees it. On: every member who joins from
// SETUP_GATE_SINCE on — the ones who are already in get the feed's checklist, not a lock.
export const SETUP_GATE_FOR_ALL = true;
export const SETUP_GATE_SINCE = '2026-10-20T00:00:00Z';
