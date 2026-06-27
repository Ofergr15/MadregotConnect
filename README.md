# MadregotConnect

AI-powered workout uploader for Garmin Connect. A web app for running coaches to parse training plans from text or images and push structured workouts to athletes' Garmin watches.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create Supabase project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Run the SQL in `supabase/schema.sql` in the SQL Editor
3. Copy your project URL and keys

### 3. Configure environment variables

Copy `.env.local.example` to `.env.local` and fill in:

```bash
cp .env.local.example .env.local
```

- `NEXT_PUBLIC_SUPABASE_URL` — Your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Your Supabase anon/public key
- `SUPABASE_SERVICE_ROLE_KEY` — Your Supabase service role key
- `ANTHROPIC_API_KEY` — Your Claude API key from [console.anthropic.com](https://console.anthropic.com)

### 4. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### 5. Deploy to Vercel

```bash
npx vercel
```

Add environment variables in Vercel dashboard → Settings → Environment Variables.

## How It Works

1. **Coach** pastes a training plan text or uploads an image
2. **AI** (Claude) parses it into structured workouts with days, steps, and pace targets
3. **Coach** reviews and edits the parsed workouts
4. **Coach** pushes to all athletes — workouts appear on their Garmin training calendar
5. **Athletes** sync their watch via Garmin Connect Mobile and see the workouts

## Tech Stack

- **Frontend**: Next.js 14 (App Router), TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes
- **Database**: Supabase (PostgreSQL)
- **AI**: Claude API (Anthropic) for text/image parsing
- **Garmin**: Unofficial Garmin Connect API via `garmin-connect` package
- **Deployment**: Vercel
