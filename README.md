# MadregotConnect

Running-club PWA for the Madregot club. Coaches parse training plans from text or
images with AI and push structured workouts to athletes' Garmin watches; athletes
get a Hebrew-first mobile app with their program, a Strava-style activity feed,
attendance, academy reports and push notifications.

- **Frontend**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS, `next-intl` (he/en, RTL)
- **Backend**: Next.js API routes + Vercel Cron
- **Database**: Supabase (PostgreSQL)
- **AI**: Claude API for plan text/image parsing
- **Garmin**: unofficial Garmin Connect API via the `garmin-connect` package
- **Deployment**: Vercel (Pro — cron routes rely on `maxDuration = 300`)

Requires **Node >= 22.12**.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create the database

Create a project at [supabase.com](https://supabase.com), then run the SQL in
this order in the SQL Editor. **Both steps are required** — `schema.sql` creates
the base tables (`coaches`, `groups`, `athletes`, `weekly_plans`,
`workout_deliveries`, `athlete_activities`) and the migrations build everything
else on top of them. Running only one of the two leaves the app unable to boot.

1. `supabase/schema.sql` — the base tables.
2. Every file in `supabase/migrations/` **in numeric order**, from
   `000_extensions.sql` through the highest-numbered file (currently
   `076_notification_image.sql`, 72 files).

Migrations are applied by hand in the SQL Editor; there is no `supabase db push`
wired up in this repo. To concatenate them in order for a single paste:

```bash
for f in supabase/migrations/*.sql; do echo "-- $f"; cat "$f"; echo; done > /tmp/all-migrations.sql
```

Then copy your project URL and API keys from Settings → API.

### 3. Configure environment variables

```bash
cp .env.local.example .env.local
```

`.env.local.example` documents every variable the app reads, grouped by the
feature it unlocks and annotated with what breaks when it's missing. Only the
first block ("Core") plus `ENCRYPTION_KEY` is needed to boot; the rest are
per-feature and degrade gracefully when blank.

Two that catch people out:

- **`ENCRYPTION_KEY`** must be 64 hex characters, and is **not rotatable in
  place** — a new key cannot decrypt existing Garmin/Strava connections. Generate
  a fresh one only for an empty database.
- **Push notifications** need a matched `NEXT_PUBLIC_VAPID_PUBLIC_KEY` /
  `VAPID_PRIVATE_KEY` pair (`npx web-push generate-vapid-keys`). With either
  missing, sending silently no-ops rather than erroring.

### 4. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 5. Deploy to Vercel

```bash
npx vercel
```

Add the same environment variables in Vercel → Settings → Environment
Variables. The cron schedules in `vercel.json` are registered automatically on
deploy.

> When pulling Vercel env vars locally, always target a temp path —
> `vercel env pull /tmp/mc-vercel.env --environment=production`. The default
> destination is `.env.local`, which overwrites your own file.

## Development

```bash
npm run check      # typecheck + tests + lint + build (run before pushing)
npm run typecheck
npm run test       # vitest
npm run lint
```

Bump `src/lib/version.ts` and `package.json` together for each change (patch
bumps by default).

### Dates and times — two deliberate conventions

This trips up every change that touches a timestamp, so it's documented in
`src/lib/utils.ts` as well:

- **Activity timestamps** (`athlete_activities.start_time`) store Garmin's
  `startTimeLocal` *wall-clock* in a `TIMESTAMPTZ` column that Postgres reads as
  UTC. The athlete's real local time therefore **is** the timestamp's UTC
  wall-clock — accessors must read UTC parts, and comparing these to `Date.now()`
  silently loses Israel's offset.
- **"Now", scheduling and calendar-today** resolve in Israel wall-clock via
  `israelNow()` / `israelToday()` / `israelDateAnchor()`.

Do **not** try to fix this by setting a global `TZ` — that was tried and
reverted; `TZ` is deliberately unset outside of individual tests.

## How it works

1. **Coach** pastes a training plan or uploads an image of one.
2. **Claude** parses it into structured workouts with days, steps and pace targets.
3. **Coach** reviews and edits the parsed week.
4. **Coach** publishes — workouts land on each athlete's Garmin training calendar.
5. **Athletes** sync their watch and see the workouts; completed runs sync back
   every 5 minutes and appear in the app's feed with route maps, cadence and
   splits.

Further design notes live in `docs/` (`academy-feature.md`, `feed-plan.md`,
`run-chat-architecture.md`, `competitor-research.md`).
