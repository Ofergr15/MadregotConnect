# Native → Supabase proxy: client contract

Goal: the iOS app stops talking to `*.supabase.co`, so the Tokyo → EU move (and any later
move) is a server env change only. iOS line numbers are against `native-ios` @ 07b242fb.

## Direct Supabase calls found in `ios/Madregot`

| # | Where | Request | Response fields used |
|---|---|---|---|
| 1 | `Core/Auth/AuthClient.swift:114-143` (`HTTPAuthClient.refresh`) | `POST {SupabaseURL}/auth/v1/token?grant_type=refresh_token`, headers `Content-Type: application/json`, `apikey: {SupabaseAnonKey}`, body `{"refresh_token": "..."}` | `access_token`, `refresh_token` (required), `expires_in` (default 3600), `user.email`, `user.user_metadata.athlete_id`; 400/401 → `.sessionRejected` |
| 2 | `Features/ProgramWeeks/ProgramWeeksModel.swift:58-86` (`PlanPdfPolicy`) | No request by the app; it validates `training_pdf_url` / `nutrition_pdf_url` from `GET /api/program-weeks` against `https://{SupabaseURL host}/storage/v1/object/public/program-plans/<folder>/<file>.pdf` and opens it in the system browser | The PDF itself (public bucket) |

Supporting config only (no calls): `Core/AppConfig.swift:10-11,30-31,53-67` (`supabaseURL`,
`supabaseAnonKey`, `isPairedConsistently`, `canRefreshSessions`), `Config/Info.plist:24-27`,
`Config/Base.xcconfig:9-10`, `Config/Secrets.xcconfig` (dev + `[config=Release]` prod values),
`Features/Today/WeekPlanView.swift:333` (demo policy host). No other `/auth/v1`, `/storage/v1`,
`/rest/v1` or `supabase.co` use.

Indirect, not changed here: `avatar_url` / `avatarUrl` values the API returns are opened as-is
(`ProfileView.swift:114`, `TeammateProfile.swift:178`). If any of those rows are Supabase
storage URLs, they need a data rewrite at the move, not an app change.

## Route 1 — `POST /api/native/auth/refresh` (public)

Request: `POST {apiBaseURL}/api/native/auth/refresh`, `Content-Type: application/json`,
body `{"refresh_token": "<current refresh token>"}`. **No `apikey`, no Authorization.**

Responses (`Cache-Control: no-store`):
- `200` `{access_token, refresh_token, expires_in, expires_at, token_type, user}` — `user` is
  GoTrue's user object unchanged (`email`, `user_metadata.athlete_id`). The refresh token is
  rotated; store the new one exactly as today.
- `400` / `401` — passed through from Supabase, body `{error, error_description}` → `.sessionRejected`.
- `400 {error:"invalid_request"}` — missing body field (app bug; treat as `.sessionRejected`).
- `429 {error:"too-many"}` + `Retry-After: 60` — 30/min per client IP. Treat as `.server(status:)`, keep the session.
- `502` / `503` — upstream unreachable / server not configured. Treat as `.serverUnavailable`, keep the session.

iOS change:
- `AuthClient.swift:117` — drop the `supabaseURL`/`supabaseAnonKey`/`isPairedConsistently` guard.
- `AuthClient.swift:120-125` — URL becomes `config.apiBaseURL.appending(path: "api/native/auth/refresh")`
  with no query; remove the `apikey` header. Body and parsing (`:127-142`) unchanged.
- `AuthClient.swift:79` doc comment; `AppConfig.swift:67` `canRefreshSessions` → `true`
  (the server is now always paired with its own project, so the dev/prod pairing check is moot).

## Route 2 — program PDFs via `GET /api/program-weeks` + `GET /api/native/storage/program-plans/{folder}/{file}`

`GET /api/program-weeks` (unchanged auth: open, as today) now adds to every row:
- `training_pdf_native_url`, `nutrition_pdf_native_url`: `string | null`, site-relative.
  - bucket object (any project host, including rows written under the old project) →
    `/api/native/storage/program-plans/<training-program|nutrition-plan>/<file>.pdf`
  - legacy `/plans/<folder>/<file>.pdf` → unchanged
  - anything else / null → `null` (show "not available")
- `training_pdf_url` / `nutrition_pdf_url` are unchanged (the PWA still reads them).

`GET {apiBaseURL}/api/native/storage/program-plans/{folder}/{file}.pdf` → `302 Location:
{current project}/storage/v1/object/public/program-plans/{folder}/{file}.pdf`
(`Cache-Control: no-store`); `404` for any other folder / non-`.pdf` / traversal. The bucket is
public today, so the route is open; access is unchanged. If it ever goes private this route
becomes JWT-gated and the app must send `Authorization` — not the case now.

iOS change:
- `ProgramWeeksModel.swift:125` — read `o["training_pdf_native_url"]` / `o["nutrition_pdf_native_url"]`
  (fall back to the old keys only while an old server may answer).
- `ProgramWeeksModel.swift:76-81` — the site-relative branch also accepts the prefix
  `/api/native/storage/program-plans/` (same two folders, same file rules) on the API host.
- `ProgramWeeksModel.swift:58-71,84-86` — drop `storageHost`, `bucketPrefix` and the absolute-URL
  branch; `WeekPlanView.swift:333` demo policy loses `storageHost`.

## After both ship

Remove `SupabaseURL` / `SupabaseAnonKey` from `Info.plist:24-27`, `Base.xcconfig:9-10` and
`Secrets.xcconfig`, and `AppConfig.swift:10-11,30-31,53-60`.
