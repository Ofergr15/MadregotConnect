# QA matrix — walking the whole app on a phone

For the pass Ofer asked for: *"go through all the functionality and make sure
everything works properly and that the customer experience is excellent, tested
with the iPhone connected, while actually running and using all the available
features."*

This is the checklist for that session. It covers all 39 page routes.

The tab tables in §1 are not from memory — they're what `useNavItems()` +
`BottomTabBar` actually compute from the live `role_tab_permissions` rows, worked
through by hand. So a bar that doesn't match on the phone is a real bug, not a
stale doc.

The two features under **"skip the chat and the ai photos"** (Personal Chat /
run-chat, and the AI photo + share-graphics work) are listed in §4 as *out of
scope* — don't test them, don't file bugs against them.

---

## 0. Before you start

| Step | What | Why it matters |
|---|---|---|
| 0.1 | Install the PWA: Safari → Share → **Add to Home Screen** | Push, standalone chrome and the splash only behave correctly from the home-screen icon. Testing in a Safari tab will produce false failures. |
| 0.2 | Launch from the home-screen icon, not Safari | Same reason. |
| 0.3 | Maintenance mode is **ON** — confirm your address is on the allowlist (`/api/maintenance?email=<you>`) | Everyone else sees the maintenance screen. If you get it too, you're not on the list. |
| 0.4 | Sign in as yourself | You're a super-user, so your effective role is `admin` regardless of your DB role. |
| 0.5 | Check the version in Settings | Should be **2.39.16** once `perf/app-speed` is merged. Anything else and you're testing a different build. |
| 0.6 | Have a second non-admin account, or use **view-as** | Most of this matrix is about what a *runner* sees, which is not what you see. |

**View-as** (`getViewMode()`) overrides your role for navigation only. It changes
which tabs render; it does **not** change what the APIs hand you. So it's the
right tool for §1 and layout, and the wrong tool for testing permissions.

One quirk to know while using it: the profile tab is force-added for *athletes*,
and in view-as that force-add is skipped for `admin` / `coach` / `academy_coach`.
So פרופיל appearing or vanishing between your real session and a preview is
expected, not a bug.

---

## 1. Navigation — the exact bar each role should get

Tab permissions control **tab-bar visibility only**. Neither `(app)/layout.tsx`
nor `middleware.ts` checks them, so any signed-in user who types a URL reaches
the page. The real protection is each API route's own gate. Two consequences:

- "The tab isn't there" is not a security finding.
- A page reached by URL that shows *someone else's data* **is** one — note it.

The bar is up to 4 primary tabs + **עוד**, each rendered as an icon **with a
small label under it**. Staff additionally get a 5th slot in the middle pointing
at **נוכחות**.

### runner

**Bar:** פיד · לוח בקרה · תוכנית · פרופיל · עוד
**More → morePages:** סקירה · פעילויות · יומן
**More → quickActions (every role):** חיפוש · חנות · הטבות

- [ ] Exactly those four tabs, in that order
- [ ] Nothing staff-ish anywhere: no מתכנן, ספורטאים, קבוצות, נוכחות, משוב אימונים, נפח הקבוצה, היסטוריה, הגדרות, כלי מאמן
- [ ] More sheet opens on tap, closes on swipe-down and on backdrop tap

### core_runner

Identical to runner, **plus מתכנן in More**: סקירה · מתכנן · פעילויות · יומן.

- [ ] ⚠️ Decide whether that's intended. `/dashboard/plan/new` is the coach's
      plan-authoring screen — it writes the club's weekly plan and can push
      workouts to Garmin. A `core_runner` holding it reads like a mis-seeded
      permission row rather than a feature. Open it as that role, see what the
      API actually lets you save, and tell me.

### admin — this is you

**Bar:** פיד · לוח בקרה · [נוכחות] · ספורטאים · משוב אימונים · עוד
(נוכחות is the middle staff slot, so it sits between the 2nd and 3rd tabs.)
**More → morePages, in this order:** סקירה · מתכנן · אקדמיה · קבוצות · פעילויות · תוכנית · נוכחות · נפח הקבוצה · יומן · היסטוריה · הגדרות · פרופיל · כלי מאמן

- [ ] 13 cards in the More grid, in that order
- [ ] נוכחות appears twice — once as the middle bar slot, once as a More card.
      Intended (it's excluded from *flat tabs* only), but eyeball it and say if
      it looks wrong.
- [ ] פרופיל is there only because your account also has an athlete row. Fine.
- [ ] ⚠️ **אימון (`/dashboard/practice`) is missing entirely.** `practice` is
      enabled for `academy_coach` and `academy_user` only, so as admin there is
      no route to it from the UI. Open `/dashboard/practice` by URL, decide
      whether admin should have the tab, and tell me.

### coach

**Bar:** פיד · לוח בקרה · [נוכחות] · ספורטאים · כלי מאמן · עוד

- [ ] ⚠️ **The 4th tab is כלי מאמן, not משוב אימונים.** `workout-feedback` is
      enabled for `admin` only, so a coach has no route at all to the feedback
      triage list — even though it's 4th in the staff primary order and coach
      tools then slides up into the slot. If coaches are meant to triage pain
      reports (they're the ones who'd act on them), that permission row needs
      adding. **This is the most consequential finding in this document.**
- [ ] ⚠️ A coach gets the **נוכחות** slot even though `practice-attendance` is
      not enabled for `coach` — the staff slot renders unconditionally. Tap it
      and see whether the page works or the API refuses. Either way the two
      should agree.
- [ ] No אימון for coach either (see admin).

### academy_coach

**Bar:** פיד · לוח בקרה · [נוכחות] · כלי מאמן · אקדמיה · עוד
**More → morePages:** פעילויות · תוכנית · אימון · נפח הקבוצה · יומן

- [ ] אקדמיה opens the coach console, not an athlete view
- [ ] No ספורטאים, no קבוצות, no הגדרות, no סקירה — expected
- [ ] Same unconditional נוכחות slot as coach; same check

### academy_user

**Bar:** פיד · לוח בקרה · תוכנית · פרופיל · עוד
**More → morePages:** סקירה · פעילויות · אימון · יומן · אקדמיה

- [ ] אקדמיה appears even though migration 022 denies the tab. Correct:
      membership is the `is_academy` flag, force-added in code, because no
      role row can express it. It should open the athlete's *own* academy view.
- [ ] אקדמיה is the **last** card (it's appended after the permission list)

### viewer

Only three tabs are permitted — and **feed is not one of them**.

**Bar:** לוח בקרה · תוכנית · פרופיל · פעילויות · עוד
**More:** quickActions only (no morePages group)

- [ ] ⚠️ `/feed` is the app's landing page. Sign in as a `viewer` and see where
      you actually land. If it's a screen with no tab, that's a dead end on
      first launch — worth knowing before anyone is given this role.
- [ ] פעילויות is 4th only as a fallback fill; without an athlete row you'd get
      three tabs. Either is fine.

---

## 2. Screen by screen

Mark each ✅ works · ⚠️ works but feels wrong · ❌ broken. For ⚠️/❌ note **what
you tapped** and **what you expected** — that's what makes it fixable.

### 2.1 Getting in

| # | Do this | Expect |
|---|---|---|
| 1 | Cold-launch from the home-screen icon | Splash, then the feed. No flash of a login screen if already signed in. |
| 2 | Sign out, sign back in (`/login`) | Lands on the feed, bar correct for your role |
| 3 | `/login` with a wrong password | A readable Hebrew error, not a raw 400 |
| 4 | `/admin/login` | The staff entry works and lands on the dashboard |
| 5 | An address with no `athletes` row | `/pending-approval`, not a 403 dead end |
| 6 | `/auth/resolve` (magic-link / callback landing) | Resolves and forwards; never parks on a blank page |
| 7 | Airplane mode, then launch | Cached screens still paint (SWR); no white screen |
| 8 | Root `/` while signed out | Redirects to login rather than rendering an empty shell |

### 2.2 Invite and join links — test on the phone, in Safari, cold

These are the first thing a new athlete ever sees, and they're the least-walked
paths in the app.

| # | Do this | Expect |
|---|---|---|
| 1 | `/invite/[token]` from a real invite | Recognises the token, shows who invited you |
| 2 | `/join/[token]` | Sign-up flow completes and creates the athlete row |
| 3 | `/join/onboard` | Continues straight into onboarding, no dead end |
| 4 | `/join/academy/[token]` | Academy-specific join works and sets `is_academy` |
| 5 | `/academy-register` | Standalone academy registration works |
| 6 | An expired or already-used token | A clear Hebrew message, not a crash or a silent blank |
| 7 | `/garmin-callback` after connecting Garmin | Returns you into the app, connection recorded |

### 2.3 Onboarding

Built for *"all the athletes are in the platform but they never really used the
app — so they are new."* Not yet browser-verified on production; this is its
first real test, and maintenance mode is still hiding it from everyone else.

| # | Do this | Expect |
|---|---|---|
| 1 | An athlete whose onboarding isn't complete | The prompt appears with a % complete |
| 2 | The install step | iOS-Safari-specific "Add to Home Screen" guidance |
| 3 | "Complete your profile" | Goes **to the profile screen** — not a dead card |
| 4 | Fill name / birth date / gender / shoe / shirt / phone | Saves, % climbs, survives a reload |
| 5 | Connect a data source | The connect flow opens; completes, or fails with a real message |
| 6 | Finish every step | The flag flips and the prompt stops appearing |
| 7 | Re-open the app | No re-prompt |
| 8 | The first-run tour | The "these are your tabs" step points at the real bar |

### 2.4 Feed (`/feed`) — the landing page

| # | Do this | Expect |
|---|---|---|
| 1 | Scroll | Cards render: name, avatar, distance, pace, time, date |
| 2 | Find one of your own runs | **The map is present.** A missing map is the exact bug you reported ("חסרה מפה"). |
| 3 | Compare a card to the same run in Garmin/Strava | Nothing missing — cadence, calories, elevation, HR. Gaps on Strava-sourced runs are known and blocked (§5). |
| 4 | Tap a card | ⚠️ **No tap-through to a full activity view exists yet.** Confirm you want one and where it should land. |
| 5 | Like / unlike | Count updates immediately and after a reload |
| 6 | Comment | Posts; mentions resolve |
| 7 | Likes sheet | Lists the right people |
| 8 | Pull to refresh | New items appear |
| 9 | Scan for duplicated runs | ⚠️ **116 duplicate Strava twins are in production.** Deleting them needs your go-ahead. |
| 10 | Post a manual activity | Saves, appears in the feed |
| 11 | Composer with text + photo | Posts |
| 12 | Tap another member's name/avatar | Opens their teammate profile (§2.11) |
| 13 | Open an old push link `/dashboard/feed?item=…` | Redirects to `/feed` keeping the item |

### 2.5 Dashboard (`/dashboard`)

| # | Do this | Expect |
|---|---|---|
| 1 | Load | Stats, weekly volume, next workout, momentum all populate |
| 2 | This week's km vs Activities | They agree |
| 3 | Next workout card | Right day, your group's paces |
| 4 | Leaderboard card | Your own number matches your profile |
| 5 | Heatmap | Days with runs filled |
| 6 | Switch group in the header | Numbers change |
| 7 | Any survey card | Opens the survey (§2.11) |

### 2.6 Program (`/dashboard/program`) — **changed this session**

Three requests now fire in one tick and the answers are cached across visits.
Not browser-verified (the page is behind the session gate), so please be thorough.

| # | Do this | Expect |
|---|---|---|
| 1 | Open it | Paints after one round trip, not two |
| 2 | Leave the tab, come back | Paints instantly from cache, then refreshes behind |
| 3 | The week it opens on | The week **containing today**, badged "נוכחי" — never an older week silently |
| 4 | Week picker | Bottom sheet; today's week highlighted and badged |
| 5 | Pick an older week | Its plan loads; the נוכחי badge goes |
| 6 | Return to today's week | Instant (cached), badge back |
| 7 | Plan-status rows | Reflect **this** calendar week even while viewing another |
| 8 | A week parsed but with no PDF | Still in the picker, still renders day cards |
| 9 | Tap a workout | Detail sheet with your group's paces |
| 10 | Attendance confirm card at the top | Appears only in the day-before/day-of window |
| 11 | Nutrition view | PDF opens |
| 12 | Gym view | Videos play, category filter works |
| 13 | As admin, upload a new week | List refreshes without a manual reload |

### 2.7 Profile (`/dashboard/profile`)

| # | Do this | Expect |
|---|---|---|
| 1 | Load | New design; avatar, member-since, stats |
| 2 | Edit personal info, save | Persists across a reload |
| 3 | Avatar upload | Shows in the header and on feed cards |
| 4 | Records / bests | Match your actual runs |
| 5 | Badges, challenges | Render; earned ones distinguishable |
| 6 | Race history | Correct |
| 7 | Shoes | Add one, assign a run, mileage accrues |
| 8 | Discoverable toggle | Changes whether you appear in discovery |

### 2.8 Activities and History

| # | Do this | Expect |
|---|---|---|
| 1 | `/dashboard/activities` | Grouped by day, newest first |
| 2 | Sync now | Pulls new runs; a failure says why |
| 3 | Open one run | Full metrics |
| 4 | `/dashboard/history` | Long range loads without stalling |

### 2.9 Feedback — athlete side (`/dashboard/feedback`)

No tab points here; it's reached from a run and from push. Test both entries.

| # | Do this | Expect |
|---|---|---|
| 1 | Submit feedback: difficulty, feel, pain, comment | Saves |
| 2 | Reply in the thread | Appears immediately and after a reload |
| 3 | Flag pain, or difficulty ≥ 9 | Coaches get a push |
| 4 | Arrive here from a push notification | Lands on the right feedback row |

### 2.10 Workout Feedback — coach triage (`/dashboard/workout-feedback`) — **changed this session**

Threads now arrive with the list instead of one request per card. Remember only
`admin` can reach this at all (§1).

| # | Do this | Expect |
|---|---|---|
| 1 | Open with 30 days selected | One request for the whole list — noticeably faster than before |
| 2 | Every card | Its own correct thread, oldest message first |
| 3 | Your own replies | Read as "mine"; other people's don't |
| 4 | A card with no replies | The empty-thread line, not a spinner |
| 5 | Reply from a card | Appears immediately, survives a reload |
| 6 | Switch 7 / 30 / 90 days | Threads still correct |
| 7 | Filters: כאב / ביקשו משוב / עם הערה / לא הגיבו | Counts match the lists |
| 8 | Your **own** feedback row in the club list | Your messages still read as yours |

### 2.11 Pages with no tab — reachable only by link, push or deep link

Easy to forget precisely because nothing in the bar points at them.

| Route | Check |
|---|---|
| `/dashboard/notifications` | Rows load fast (this was slow and got fixed). Every row's deep link opens the right thing. |
| `/dashboard/teammate/[id]` | A peer's public profile: identity, group, member-since, follower/following counts, follow/unfollow. **No email, no onboarding status, no Garmin details** should be visible — it's a privacy-safe projection, so check. |
| `/dashboard/surveys/[id]` | The question and options render in Hebrew, you can answer once, your answer is remembered, a closed survey says so |
| `/dashboard/calendar/[id]` | Event detail and registration |
| `/dashboard/search` | Finds athletes, activities and sections; the sections it offers match the tabs your role actually has |
| `/dashboard/coach-tools` | Every tool in the hub opens |
| `/dashboard/practice` | Only academy roles have the tab — open it by URL and see what happens for admin |
| `/iphone-preview` | Internal showcase pointing at an old preview deployment. Expect it to be stale/broken; **not a bug worth filing**, just tell me if you'd rather it were deleted. |

### 2.12 Coach and admin screens

| Screen | Check |
|---|---|
| ספורטאים | Roster loads; add / edit / remove; group assignment; data-source switch; invite link generation |
| קבוצות | Groups and members; pace offsets |
| מתכנן (`plan/new`) | Paste a workout → parse → save; push to Garmin; per-group variants; clipboards; import from program |
| נוכחות | Roster marks; RSVP counts |
| נפח הקבוצה | Per-athlete weekly volume agrees with the dashboard |
| סקירה | Coach pulse / review queue |
| הגדרות | Notification prefs, locale switch, tab permissions editor, maintenance toggle, version string |
| אקדמיה | Pairing + planner (both built and merged). Blocked on **data**, not code: all six `academy_bands` rows have `pace_profile.offsetSeconds` unset, and only **1 of 26** club rows has `is_academy = true`. Expect thin screens until that's fixed — don't file it as broken. |
| יומן | Event list, detail, registration |
| חנות | Products, cart, order |
| הטבות | Perks list |

### 2.13 Notifications and push

| # | Do this | Expect |
|---|---|---|
| 1 | Enable push, then `/api/push/test` | Arrives on the phone |
| 2 | Kill the app, send another | Still arrives |
| 3 | The notification's icon | The home-screen icon — iOS ignores per-message icons, so that's correct |
| 4 | Tap a notification cold | Opens the right screen, not just the feed |
| 5 | Notification prefs in Settings | Toggles persist |

### 2.14 Cross-cutting

| # | Check |
|---|---|
| 1 | **RTL** — nothing mirrored wrong, no LTR numbers stranded in the wrong place |
| 2 | **Hebrew** — no untranslated English, no `{placeholder}` leaking through |
| 3 | **Safe areas** — nothing under the notch or the home indicator; the bar stays pinned during scroll momentum |
| 4 | **Tap targets** ≥ 44 px |
| 5 | **Bottom sheets** — swipe-down closes, backdrop closes, focus trapped |
| 6 | **Back gesture** from every screen |
| 7 | **Dark-on-dark text** — one has shipped past `npm run check` before; look for it |
| 8 | **Rotation** and iOS large-text |
| 9 | **Slow network** (Network Link Conditioner) — skeletons, not blank screens |
| 10 | **Speed, subjectively** — this session cut roughly 195 KB of JS off every route and removed a round trip from the program page. It should feel faster from a cold launch. Say whether it does; that's the only measurement that matters for the goal you set. |

---

## 3. Reporting back

Per finding: **screen → what you tapped → what happened → what you expected**,
plus a screenshot if it's visual. That maps straight onto a fix. A list of screen
names with "broken" next to them doesn't.

---

## 4. Out of scope — do not test

- **Personal Chat / run-chat** — `/dashboard/run-chat/[activityId]` and its
  `/demo`, plus `src/components/run-chat/`. Covered by *"skip the chat and the ai
  photos"*.
- **AI photos / share graphics** — `/dashboard/photos` and the IG/FB graphics.
  Same exclusion. Note the More-sheet card for it is deliberately commented out,
  and `photos` is enabled in `role_tab_permissions` for most roles but has no
  `ALL_NAV_ITEMS` entry — so the tab can never appear. Consistent with the
  exclusion; recorded here so it doesn't read as a bug later.
- **`races`** — permitted for most roles, but there's no nav item and no page at
  all. Dead permission rows.

---

## 5. Already known — don't spend phone time rediscovering these

| Item | State |
|---|---|
| 116 duplicate Strava twin activities in production | Needs your explicit go-ahead to delete |
| Strava sync data gaps (cadence, calories) | Blocked three ways: `STRAVA_CLIENT_ID/SECRET` aren't available locally, your token expired 2026-08-28, and your `data_source='garmin'` makes the Strava cron skip you anyway |
| No tap-through from a feed card to a full activity view | Not built |
| Migration `054_activity_plan_matches.sql` | Waiting for you to paste it into the Supabase SQL editor |
| Migration `079_athletes_email_unique.sql` | Written; a no-op on production, needed for any restored or staging DB |
| `coach_last_read_at` / `athlete_last_read_at` | Written on every read, but nothing reads them — there's no unread badge yet |
| `GET /api/groups` returns every member's email | You said keep it for later |
| `academy_bands` offsets unset; 1 of 26 rows `is_academy` | Data, not code |
| `BottomTabBar.tsx` re-declares `ALL_NAV_ITEMS`, `PROFILE_ITEM`, `COACH_TOOLS_ITEM` and `TabPermission` that `nav-items.ts` already exports | Real drift risk — `nav-items.ts` was extracted specifically so the bar and the search page couldn't disagree, and the bar then kept its own copy. Worth collapsing. |
