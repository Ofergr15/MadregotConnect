# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 95 — Strava webhook idempotency

- **Is per-instance (in-memory) dedupe enough, or do you want a DB table of processed Strava event ids?** Default shipped: in-memory per warm instance, plus a DB check that a `create` for an already-stored activity is skipped. A duplicate can still cost one extra sync on a cold instance, never a duplicate run (the import upserts on the Strava id). A table would need a migration; not added.

## Task 171 — Hebrew copy lint

- **Neutral form for buttons and sentences: noun + plural imperative, as shipped?** Default shipped: buttons and labels take a noun ("שמירה", "בחירת קבוצה", "ביטול"), sentences take the plural imperative the app already uses most ("נסו שוב" ×78, "הזינו", "בחרו") or "אפשר ל…". The alternative is the infinitive everywhere ("לשמור", "לנסות שוב"). One answer and the lint's wording is final; the 233 hardcoded-Hebrew hits in `src/` follow the same rule in later PRs.
- **"מגיע/ה" on the RSVP button became "אגיע".** First-person future is the only one-word neutral form. Default: "אגיע". Say if you'd rather "אני בא/ה"-free wording like "מגיעים" (plural, reads like a status).
