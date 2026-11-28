# Night-run owner questions

Each entry: task, question, and the safe default the PR shipped with.

## Task 111 — Playwright smoke on seeded data + axe
- The seeded club is answered in the browser (tests/a11y/seeded-club.ts), not read from a seeded dev database (#233's seed-dev): the run must never need a database or keys. Want a second mode later that points the smoke at a seeded dev project? **Default:** fixtures only.
- `AthleteLink` now sets its "צפייה בפרופיל של …" label only when the link shows no text (an avatar). Links that show the name are announced by the name (WCAG 2.5.3). OK to lose the "view profile of" prefix on those? **Default:** yes. Voice-control users say what they see.
- The hero pill "AFTER 2KM" text goes from brand-600 to brand-700 (#0F1CCC). brand-600 measured 4.44:1 on the pill's wash, just under 4.5. **Default:** brand-700, the existing pressed shade.
- Still not in CI (needs a second build, ~3 min), same as #206. **Default:** script only (`npm run test:a11y`).
