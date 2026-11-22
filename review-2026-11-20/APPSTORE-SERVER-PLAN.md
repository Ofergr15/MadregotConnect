# App Store — server-side plan (not built yet)

Written 2026-11-23 overnight. Plan only; nothing here is implemented. Each item is meant to be its own PR.

## 1. Public `/privacy` and `/support` pages (Hebrew + English)

- **Where:** `src/app/privacy/page.tsx` and `src/app/support/page.tsx`, at the top level and outside `(app)`, so the signed-in shell's auth gate never runs. Static server components with no Supabase read: `export const dynamic = 'force-static'`.
- **Locale:** Hebrew by default, as everywhere else. `?lang=en` (or the `NEXT_LOCALE` cookie) switches to English, so App Store Connect can link one URL per language. Strings go in `messages/{he,en}.json` under `legal.*`, with the same keys in both files.
- **`src/proxy.ts`:** check that both paths are in the public allowlist and are not redirected to `/login`. Add a test that requests each path signed out and expects 200.
- **Privacy content:** what the app collects (account, Garmin/Strava activities and GPS, HR, photos, push tokens) and why; who can see it (club members see runs and GPS by product decision, 2026-09-03; the plan verdict is self-or-staff; hidden fields are masked); where it is stored (Supabase, region); retention; how to delete (item 2); a contact address. The owner must approve the wording. Draft it, don't publish it.
- **Support content:** a contact email, FAQ (connecting a watch, a missing run, deleting the account), and a link to the privacy page.

## 2. Real in-app account deletion (Apple 5.1.1(v))

Today `POST /api/account/delete-request` only files a request, and an admin later runs `anonymise_athlete()`. Apple requires that deletion can be *initiated and completed* in the app. Plan:

- `POST /api/account/delete` is **self only**: the identity comes from `resolveVerifiedCaller`, and any id in the body is ignored (CLAUDE.md: no deletion driven by a body field). It requires a fresh confirmation (`{ confirm: "DELETE" }`) and refuses during view-as.
- Body of the route: `anonymise_athlete(<self id>)` (the club keeps its aggregate stats, anonymised), then disconnect Garmin and Strava (delete the tokens in `athletes.garmin_auth` and the Strava auth), remove push subscriptions, and delete the Supabase auth user (`auth.admin.deleteUser`). Reuse `lib/admin/purge-athlete.ts` (`SUBJECT_COLUMNS`) so the list of tables can't drift.
- Staff accounts and the super user are refused with a message pointing to the admin, so the club can't lose its only admin by accident.
- Mark the matching `account_deletion_requests` row `done`. Notify admin through `recipientsForKind('account_delete_request')`, as an informational message only.
- Tests: refused for another athlete's id in the body, refused in view-as, refused for staff, idempotent, and the auth user is deleted.
- **Exposure note** for CLAUDE.md: this is the first self-service destructive route.

## 3. App Review sign-in account

- A dedicated `athletes` row, e.g. "App Review", with role `runner`, active, in group 2, flagged as a test account in `lib/athletes/test-accounts.ts` so it stays off leaderboards and club stats and its rows are hidden from other members.
- Seed it with synthetic activities only (synthetic GPS, per the feed-design rule), a sample plan week, and no Garmin connection. The review flow must work without a watch.
- The credentials go only into App Store Connect's review notes. Never in the repo.
- Add a server check that this account can't post to the real feed or send pushes to members (`isTestAccount` already filters the feed; also check notify paths).
- Needs the owner's OK and a manual prod write (the Supabase SQL editor). Not something to do overnight.

## 4. Kit-sizes step in native onboarding (`src/lib/onboarding/native-setup.ts`)

- Add `'kit'` to `SETUP_STEPS` (after `'group'`), with `SETUP_VALUES.kit = ['done', 'skipped']`. The sizes themselves are still written through the existing `PATCH /api/athletes/me` (`KIT_SIZE_FIELDS`, migrations 061/100, with the degrade path already there).
- `deriveSetup` input gains `kitDone` = any of the `KIT_SIZE_FIELDS` set. A user who already filled sizes on the PWA sees the step as done.
- **Compatibility:** older native builds iterate the steps they know. Check that `next` naming `'kit'` doesn't break a build that doesn't know the step (`onboardingNative.test.ts` + the iOS parser). If it would, ship `'kit'` only when the client sends `?steps=v2`.
- Gate it behind a default-off flag (`native_setup_kit`), per the gated-rollout rule.
