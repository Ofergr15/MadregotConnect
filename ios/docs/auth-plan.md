# Native sign-in plan (iOS)

Status: direction approved by Ofer on 2026-11-18. No server or production changes are part of
step A; every later step that touches the server or madregot.app needs its own approval.

## Principles

- **Signing in is to the club's own account only:** email + 6-digit code, then a passkey (Face ID).
  No Google/Strava/Apple sign-in, so App Store guideline 4.8 does not apply. Sign in with Apple is
  off the table for now (Ofer, 2026-11-18). Adding any third-party login later brings 4.8 back.
- **Strava, Garmin and Apple Health are data connections**, made after signing in, never identity.
- **Stay signed in:** the Supabase refresh token lives in the Keychain
  (`AfterFirstUnlockThisDeviceOnly`, not backed up) and is refreshed silently.

## Steps

| Step | What | Server change? |
|---|---|---|
| A | Email + code sign-in in the app; Keychain session; silent refresh; sign-out | None. Uses `POST /api/auth/email-code` (`send` / `verify`) and Supabase's own `/auth/v1/token?grant_type=refresh_token`. |
| B | Invite link opens the app with the email known (`token` → `who` → `send`) | `apple-app-site-association` on madregot.app (production file). |
| C | Passkey / Face ID sign-in and re-sign-in; syncs to a new iPhone via iCloud Keychain | New table + register/authenticate routes; same AASA file (`webcredentials`). |
| D | New-member registration screen (name, phone, group, optional intake) → "waiting for approval" | Probably none: `POST /api/public/signup` already takes these fields. To verify. |
| E | In-app account deletion (guideline 5.1.1(v)) — **required before App Store submission** | New route. Open question: immediate, or a request an admin approves. |
| F | Data connections screen: Garmin / Strava / Apple Health | Strava handoff return (see T2), migration 138 for Health. |

## What step A deliberately does not do

- It talks to whatever `MADREGOT_API_BASE_URL` / `SUPABASE_URL` the local `ios/Config/Secrets.xcconfig`
  names. That file is git-ignored. Debug builds default to `http://localhost:3000` and never to
  production. Testing a real sign-in waits for a decision on a non-production environment.
- It does not read or send the web app's `mc_device` cookie; the native app has no use for it.
