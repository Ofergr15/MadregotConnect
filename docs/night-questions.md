# Night-run owner questions

Each entry: task, question, and the safe default the PR shipped with.

## Task 109 — test speed
- `npm test` is ~16 s locally now (was 35–40 s), not the ~10 s target. The rest is per-file module isolation for the ~410 files that mock (`vi.mock`/spies/timers/env). Running everything un-isolated takes 9.9 s but 56 files fail because mocks leak between files. Getting there means converting those mocks file by file (e.g. dependency injection in place of `vi.mock`). Worth a follow-up? **Default:** no, the classifier keeps every mocking file isolated.
- Should CI print `npm run test:profile` output (top slow files) on every run? **Default:** no, script only.
