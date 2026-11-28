# Feature-flag audit (task 167)

Every switch the server and web know about, where each is read, which ones look stale,
and a plan to remove them. Regenerate the inventory with `node scripts/gen-flags-audit.mjs`
(`--check` to see whether it is stale); everything outside the generated block is hand-written.
Nothing here was read from the database: which keys are actually switched on lives only in
`feature_enablements`, so the "is it on in prod" column is a query for the owner, below.

## Three kinds of switch

1. **Enablement keys** — `FEATURES` in `src/lib/features/flags.ts`, resolved per athlete from
   `feature_enablements` (migration 191), most specific scope wins, default off. The native app gets
   all of them in one call (`GET /api/features/me`; the 4 public ones also via `GET /api/features/public`).
   A key the server also *gates on* is "server-gated"; a key only the app reads is "catalog-only" here.
2. **Code constants** — `export const X_FOR_ALL = true|false`. A deploy flips them; there is no runtime switch.
3. **`app_settings` kill switches** — rows read by key (`maintenance_mode`, `cron_paused`, `stories_paused`, …).

## What "read on iOS" means here

The only iOS source this repo may grep is the local `native-ios` branch, which is a skeleton from
2026-11-18 (11 Swift files). It reads one key (`calendar`). The real native app that reads the other
~100 keys is not in this repo, so **"catalog-only" means "no reader in this repo", not "stale"**. The
key comments in `flags.ts` name the native screen each one gates; that is the evidence the key is
live, and only the native source can prove a key dead.

## Findings

- **100 of 113 enablement keys are catalog-only.** They cost nothing at runtime (one shared read in
  `featureResolutions`), but every one is a toggle on the staff screen and a row in `/api/features/me`.
- **The server enforces 12 keys.** For the other 100, turning a key off hides a native screen but the
  API behind it still answers — the gate is UI only. That is by design for read-only screens; it matters
  for the write paths a key names in its comment (`native_mgmt_staff_week` → `PUT /api/plans`,
  `native_mgmt_packs` → `PUT /api/athletes`, `native_club_updates`, `profile_edit`, `academy_chat_send`).
  Those routes have their own role gates; the flag is not a second gate.
- **`native_mgmt_staff_week` must stay off** (its label says so): the native PlanEdit it gates writes
  `PUT /api/plans` and bypasses `weekly_plan_versions`.
- **Four `*_FOR_ALL` constants have been `true` for 5–6 weeks** (`SETUP_GATE_FOR_ALL` and
  `JOIN_UNIFIED_FOR_ALL` since 2026-10-20, `DAY_SESSION_FOR_ALL` since 10-18, `MANDATORY_UPDATE_FOR_ALL`).
  The `false` branch behind each is dead code.
- **Two `*_FOR_ALL` constants have been `false` for 7–8 weeks** (`ONBOARDING_V2_FOR_ALL` since 10-06,
  `TRAINEE_V2_FOR_ALL` since 10-11). Either the v2 path ships or it should go.
- Generic key names (`events`, `calendar`, `search`, `history`) also match table names, routes and
  i18n keys; the generator only counts a line that names the key *and* talks about features.

## Removal plan

Order is cheapest-and-safest first. Each step is its own small PR; none needs a migration.

1. **Retire the `true` constants** (`SETUP_GATE_FOR_ALL`, `JOIN_UNIFIED_FOR_ALL`, `DAY_SESSION_FOR_ALL`,
   `MANDATORY_UPDATE_FOR_ALL`): inline `true`, delete the else-branches and the constant. Pure code; the
   readers are listed in the table. Tests that toggle them go with them.
2. **Decide the `false` constants** (`ONBOARDING_V2_FOR_ALL`, `TRAINEE_V2_FOR_ALL`): ship (step 1 shape)
   or delete the v2 code. Owner call.
3. **Find the rolled-out and the never-used enablement keys** with the read-only query below, in the
   Supabase SQL editor:

   ```sql
   -- Per key: is it on for the whole club, how many rows, when it last changed.
   SELECT feature,
          bool_or(scope_type = 'club' AND enabled)            AS club_on,
          count(*)                                             AS rows,
          count(*) FILTER (WHERE enabled)                      AS rows_on,
          max(set_at)                                          AS last_set
   FROM feature_enablements
   GROUP BY feature
   ORDER BY club_on DESC, last_set;
   ```

   - `club_on = true` and unchanged for 30+ days → **rolled out**. Make the native app treat it as on
     (or keep answering `true` for it from `/api/features/me` for old builds), then drop the key from
     `FEATURES` and its server gates, and delete its rows.
   - A key that is in `FEATURES` but absent from the result, added 60+ days ago → **never used**. Ask
     whether the screen behind it still exists in the native app; if not, drop the key.
   - A row whose `feature` is not in `FEATURES` → **orphan**. `isFeatureKey` already ignores it;
     delete the rows.
4. **Old native builds**: `/api/features/me` returns `false` for a key it no longer knows only because
   the client defaults to off. Before deleting a rolled-out key, keep it in the response as a constant
   `true` until no build still in use reads it (the native version is in `client_logs` / the What's New releases table).
5. **Keep**: the 4 public keys (read signed out), the `native_mgmt_*` admin-only keys while the coach shell
   is still rolling out, and the `app_settings` kill switches (they are operations, not rollouts).

## Inventory

<!-- BEGIN:generated by scripts/gen-flags-audit.mjs -->

Generated from `src/lib/features/flags.ts` and a grep of `src/**` (tests excluded), plus a read-only `git grep` of `native-ios @ 8bc60bf5 (2026-11-18)`.

**113 enablement keys**: 12 server-gated, 0 read only by web UI, 1 read only on the native branch, **100 catalog-only** (no reader in this repo — served to the app by `GET /api/features/me` and nothing else).

| key | label | default | public | server gate | web UI | other mentions | iOS (native-ios) | status |
|---|---|---|---|---|---|---|---|---|
| `feedback_pain` | משוב ודיווח כאב | off |  | `app/api/coach/athlete/[id]/route.ts`, `app/api/feedback-prompts/route.ts`, `app/api/pain-reports/route.ts` +3 | — | — | — | server-gated |
| `records_tab` | לשונית שיאים | off |  | `lib/records/club-record-card-server.ts`, `lib/records/gate.ts` | — | `app/api/records/champions/route.ts`, `app/api/records/weekly/route.ts` | — | server-gated |
| `week_health` | השבוע — עיצוב בריאות | off |  | — | — | — | — | catalog-only |
| `race_live` | מעקב חי במרוץ | off |  | `app/api/race-live/[eventId]/link/route.ts`, `app/api/race-live/[eventId]/route.ts`, `lib/race-live/server.ts` | — | — | — | server-gated |
| `valencia_v3` | ולנסיה — עיצוב חדש | off |  | — | — | — | — | catalog-only |
| `race_live_phone` | שיתוף מיקום מהטלפון במרוץ | off |  | `app/api/race-live/[eventId]/position/route.ts` | — | — | — | server-gated |
| `history` | היסטוריית אימונים | off |  | — | — | `app/(app)/dashboard/coach-tools/page.tsx`, `app/(app)/dashboard/history/page.tsx` +5 | — | catalog-only |
| `native_coach` | מסכי מאמן באפליקציה | off |  | — | — | — | — | catalog-only |
| `events` | אירועים | off |  | — | — | `app/(app)/dashboard/content/page.tsx`, `app/(app)/dashboard/search/page.tsx` +26 | — | catalog-only |
| `run_together` | ריצות משותפות | off |  | — | — | — | — | catalog-only |
| `program_files` | רשימת קבצי התוכנית | off |  | — | — | — | — | catalog-only |
| `academy_register` | הרשמה לאקדמיה מהאפליקציה | off | yes | — | — | — | — | catalog-only |
| `u21_entry` | הרשמה ל-U21 (מאמן אישי) | off | yes | `lib/u21/flag.ts` | `app/register/U21RegisterEntry.tsx` | — | — | server-gated |
| `gateway_v4` | מסך כניסה חדש (v4) | off | yes | — | — | — | — | catalog-only |
| `profile_badges` | כרטיס תגים בפרופיל | off |  | — | — | — | — | catalog-only |
| `calendar` | לוח המועדון | off |  | — | — | `app/(app)/dashboard/calendar/page.tsx`, `app/(app)/dashboard/coach-tools/page.tsx` +7 | `ios/Madregot/Features/Home/MainTabView.swift` | native (branch) |
| `native_mgmt_attendance` | נוכחות באימונים (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `academy_coach` | לשונית מאמן אקדמיה (אפליקציה) | off |  | — | — | `app/(app)/dashboard/academy/page.tsx`, `app/(app)/dashboard/coach-tools/page.tsx` +41 | — | catalog-only |
| `academy_trainee` | בית מתאמן אקדמיה (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `native_mgmt_entry_queue` | תור כניסה (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `native_mgmt_onboarding_funnel` | משפך הצטרפות (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `native_mgmt_control_room` | חדר בקרה (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `native_mgmt_push_health` | בריאות התראות (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `native_mgmt_data_check` | בדיקת נתונים (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `native_mgmt_numbers` | מדרגות במספרים (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `native_mgmt_coach_insights` | תובנות מאמן (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `native_mgmt_plan_history` | היסטוריית תוכניות (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `new_record_sheet` | מסך שיא חדש (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `wellness_strip` | פס בריאות (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `week_summary` | סיכום שבועי (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `birthday_year_card` | כרטיס שנה ביום הולדת (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `apple_health` | Apple Health (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `academy_pack` | חבילת אקדמיה (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `academy_chat_send` | שליחה בצ׳אט אקדמיה (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `academy_week_moments` | רגעי השבוע באקדמיה (אפליקציה) | off |  | `app/api/academy/week-moments/route.ts`, `app/api/academy/week-moments/send/route.ts`, `lib/academy/week-moments-server.ts` | — | `app/api/academy/read-nudge/route.ts`, `app/api/academy/week-moments/receipts/route.ts` | — | server-gated |
| `notif_prefs` | העדפות התראות (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `native_mgmt_packs` | ניהול דבוקות (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `data_sources` | חיבור שעון באפליקציה | off |  | — | — | — | — | catalog-only |
| `season_program` | תוכנית העונה (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `profile_edit` | עריכת פרופיל (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `native_club_updates` | עדכוני מועדון (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `native_mgmt_day_session` | אימון איכות ויום אימון (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `native_mgmt_registrations` | אישורי הרשמה (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `native_mgmt_groups` | קבוצות וחברים (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `native_mgmt_roles` | תפקידים וניתוב התראות (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `native_mgmt_scheduled` | התראות מתוזמנות (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `native_mgmt_staff_week` | תוכנית שבוע לצוות (אפליקציה) — לא להפעיל עדיין | off |  admin-only | — | — | — | — | catalog-only |
| `native_help` | עזרה ומה חדש (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `native_viewer_feed` | פיד לחשבון צפייה (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `native_mgmt_coach_tools` | כלי מאמן (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `native_mgmt_athletes` | רשימת הרצים (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `native_photos` | גלריית תמונות (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `perf_cache_first` | פתיחה מיידית מהעותק השמור (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `perf_server_shapes` | נתונים קלים יותר מהשרת (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `club_tab` | לשונית מועדון (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `native_benefits` | הטבות (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `native_club_stories` | סטוריז מועדון (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `native_core_perks` | הטבות ליבה (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `native_mgmt_access` | ניהול גישה (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `native_mgmt_birthdays` | ימי הולדת (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `native_mgmt_finance` | כספים (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `native_mgmt_content` | ניהול תוכן (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `native_mgmt_pack_moves` | העברות בין דבוקות (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `native_mgmt_pain` | דיווחי כאב (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `native_mgmt_people` | אנשים (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `native_mgmt_plan_builder` | בונה תוכניות (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `native_mgmt_review` | סקירה (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `native_mgmt_signup_tests` | מבחני הרשמה (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `native_mgmt_team_volume` | נפח קבוצתי (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `native_mgmt_training` | ניהול אימונים (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `native_practice` | אימונים (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `native_run_share` | שיתוף ריצה (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `native_store` | חנות (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `native_surveys` | סקרים (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `perf_get_memo` | זיכרון בקשות (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `profile_trend` | מגמה בפרופיל (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `run_chat` | צ׳אט ריצה (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `search` | חיפוש (אפליקציה) | off |  | — | — | `app/(app)/dashboard/search/page.tsx`, `components/BottomTabBar.tsx` +5 | — | catalog-only |
| `teammate_full` | פרופיל חבר מלא (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `native_mgmt_pack_stories` | סטוריז דבוקה (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `native_mgmt_u21_admin` | הרשמות U21 (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `native_mgmt_release_rehearsal` | חזרה לפני שחרור (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `native_review` | סקירה (אפליקציה, מתאמן) | off |  | — | — | — | — | catalog-only |
| `native_resend_workout` | שליחה חוזרת לשעון (אפליקציה) | off |  | `app/api/me/watch/resend/route.ts` | — | — | — | server-gated |
| `run_detail_v2` | פרטי ריצה — עיצוב חדש (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `native_onboarding_setup` | הצטרפות — צ׳קליסט הגדרה (אפליקציה) | off | yes | — | — | — | — | catalog-only |
| `strength_training` | אימוני כוח | off |  | `app/api/activities/strength/route.ts`, `app/api/activities/strength/week/route.ts`, `lib/activities/strength-feed.ts` +2 | — | `lib/activities/kinds.ts` | — | server-gated |
| `photos_drive_v2` | תמונות מ-Drive v2: סטטוס, קישור לאימון, בלי כפילויות | off |  | `app/api/admin/photos-status/route.ts`, `app/api/photos/browse/route.ts`, `app/api/photos/session/route.ts` +2 | — | — | — | server-gated |
| `native_self_group_change` | שינוי דבוקה עצמי (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `club_stats_monthly` | המועדון חודש מול חודש (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `native_mgmt_leads` | לידים (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `native_mgmt_manager_home_v2` | בית מנהל חדש (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `photos_social` | תמונות: תיוג ידני (התמונות שלי) ולייקים (אהבתי) | off |  | `app/api/photos/likes/route.ts`, `app/api/photos/tags/route.ts`, `lib/photos/tags-gate.ts` | — | — | — | server-gated |
| `academy_pack_attendance` | נוכחות בדבוקה (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `academy_pack_leader` | מוביל/ת דבוקה (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `academy_race_plan` | תוכנית מרוץ ממאמן (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `athlete_races` | המרוצים שלי (אפליקציה) | off |  | — | — | `app/api/academy/my-races/route.ts`, `app/api/academy/race-plan/route.ts` | — | catalog-only |
| `academy_pack_chat` | צ׳אט דבוקה + סיכום שבועי (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `academy_read_nudge` | תזכורת למי שלא קרא (אפליקציה) | off |  | `app/api/academy/read-nudge/route.ts` | — | — | — | server-gated |
| `native_chat_group_edit` | עריכת קבוצת צ׳אט (אפליקציה) | off |  | `app/api/chat/group/route.ts` | — | — | — | server-gated |
| `feed_banner` | באנר עליון בפיד: ציון איכות, שיאים (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `coach_late` | מאמן מאחר: הזזת שעת האימון (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `data_check` | בדיקת נתונים לרץ (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `signin_magic` | כניסה במייל: הדבקת קוד וקישור קסם (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `native_strava_signin` | כניסה עם Strava (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `native_pack_chat` | צ׳אט קבוצה (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `native_share_v2` | שיתוף ריצה — עיצוב חדש (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `native_store_orders` | ניהול הזמנות החנות (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `native_metrickit` | דוחות קריסה ואיטיות מהטלפון (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `native_feed_comment_preview` | תצוגת תגובות בכרטיס בפיד (אפליקציה) | off |  | — | — | — | — | catalog-only |
| `native_mgmt_podium_admin` | ניהול פודיום (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `native_mgmt_rewards` | חנות והטבות (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |
| `native_mgmt_users` | משתמשים (אפליקציה) | off |  admin-only | — | — | — | — | catalog-only |

### Code-constant rollout switches (`*_FOR_ALL`)

| constant | value | defined in | read by |
|---|---|---|---|
| `DAY_SESSION_FOR_ALL` | `true` | `lib/day-session/flag.ts` | `app/(app)/dashboard/coach-tools/page.tsx`, `app/(app)/dashboard/day-session/page.tsx`, `app/api/day-session/route.ts`, `lib/day-session/model.ts` +1 |
| `JOIN_UNIFIED_FOR_ALL` | `true` | `lib/join/flag.ts` | `app/api/admin/tests/route.ts`, `app/register/page.tsx`, `components/join/JoinFlow.tsx` |
| `MANDATORY_UPDATE_FOR_ALL` | `true` | `components/UpdatePrompt.tsx` | — |
| `ONBOARDING_V2_FOR_ALL` | `false` | `lib/install/flag.ts` | `app/api/admin/registrations/approve/route.ts`, `app/api/admin/registrations/resend/route.ts`, `app/api/public/signup/route.ts`, `lib/install/v2.ts` +1 |
| `SETUP_GATE_FOR_ALL` | `true` | `lib/setup/flag.ts` | `app/api/admin/tests/route.ts`, `app/api/setup/route.ts`, `app/join/[token]/page.tsx`, `lib/email/index.ts` +1 |
| `TRAINEE_V2_FOR_ALL` | `false` | `lib/trainee/flag.ts` | `app/api/academy/completion/request/route.ts`, `app/api/admin/trainee-data-coverage/route.ts`, `app/api/athletes/notification-prefs/route.ts`, `lib/academy/deep-links.ts` +3 |

### `app_settings` switches read by key

| key | read/written in |
|---|---|
| `academy_registration_open` | `lib/testing/readiness.ts` |
| `cron_paused` | `app/api/admin/move/route.ts`, `lib/cron-pause.ts`, `lib/move/checks.ts` |
| `maintenance_mode` | `app/api/admin/overview/route.ts`, `app/api/maintenance/route.ts` |
| `stories_paused` | `app/api/admin/stories/route.ts`, `app/api/admin/stories/upcoming/route.ts`, `lib/stories/gate.ts` |

<!-- END:generated -->
