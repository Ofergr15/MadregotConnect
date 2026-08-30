# MadregotConnect agent guide

Read `CLAUDE.md` before changing code; it is the authoritative repository guide.
For the run-chat and AI coach subsystem, also read
`docs/run-chat-architecture.md`.

## Before editing

- Use Node 22 (`nvm use`).
- This is Next.js 16. Read relevant guides under `node_modules/next/dist/docs/`
  before changing framework conventions.
- Preserve the Sunday plan week / Monday activity week distinction.
- Activity timestamps are UTC-shaped local wall-clock values. Use the helpers in
  `src/lib/utils.ts`.
- Never commit `.env.local*`, `.supabase-sandbox/`, `supabase/.temp/`, database
  passwords, API-key exports, logs, or generated local previews.

## Implementation conventions

- Keep API routes thin; put reusable logic in `src/lib/`.
- Derive group identity through `resolveGroup()`.
- Use shadcn primitives in `src/components/ui/` for buttons, cards,
  collapsibles, tooltips, and avatars.
- Put user-facing strings in both `messages/en.json` and `messages/he.json`.
- Add database changes as numbered, idempotent migrations. Migrations are
  applied manually in Supabase.
- Authentication is intentionally incomplete and service-role routes bypass
  RLS. Do not widen this exposure or trust a new caller-supplied identity for
  destructive operations.

## Verification

Run `npm run check` before committing. Parser, activity matching, clipboard,
and run-analysis changes require their regression tests to remain green.

Run-chat UI changes also require `npm run test:ui`. The dev bar's **Live demo**
opens runner and coach as independent online Stream users in side-by-side panes.
