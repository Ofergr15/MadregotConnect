# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 110 — seeded dev data (scripts/seed-dev.mts)

- **Which project may it write to?** Safe default shipped: only the dev project (`DEV_SUPABASE_REF`) or a local Supabase; any other ref needs `SEED_DEV_ALLOW_REF=<ref>` and the two production refs are refused even then. Dry run unless `--apply`. Open: is there a second sandbox project that should be on the allow-list permanently?
- **Seeded runners live in the real coach's club (COACH_ID).** Default: yes, so the app's single-club screens show them; the existing dev coach row is never overwritten (insert-only). Open: should the seed use its own coach id instead, so it can be wiped cleanly?
