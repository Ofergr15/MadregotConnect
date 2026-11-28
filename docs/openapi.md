# API reference (OpenAPI)

`docs/openapi.json` is an OpenAPI 3.1 description of the routes a member's app (web or native) or an anonymous visitor may call: 336 paths, 480 operations (440 member, 36 public, 4 device), counted 2026-11-28. It is generated; do not edit it by hand.

```sh
node scripts/gen-openapi.mjs           # rewrite docs/openapi.json
node scripts/gen-openapi.mjs --check   # exit 1 if it is stale
```

`src/__tests__/openapiSpec.test.ts` fails when a route changes and the file was not regenerated, so `npm run check` keeps it current.

## Reading it

Any OpenAPI viewer works. Paste the file into editor.swagger.io, or open it in VS Code with an OpenAPI extension. The file has one line per path, so a route change shows up as a one-line diff in review.

## What is in it

- **Paths and methods** from `src/app/api/**/route.ts`. Next.js `[id]` folders become `{id}` path parameters.
- **Query parameters**: every `searchParams.get('…')` the handler reads, listed on GET and DELETE. They are all typed `string` and marked optional, because the handlers parse and validate them themselves.
- **Summary**: the JSDoc directly above the handler (`export async function GET`). If there is none, the summary is the first sentence of the file's first JSDoc, the same text `docs/api-routes.md` shows.
- **Security**: `bearerAuth` is the Supabase access token of the signed-in member. `deviceToken` is the paired-watch token (`wat1.…`). `[]` means the route is public. A route is public only if `docs/route-auth-inventory.md` allowlists it, and the reason from that table is in `x-why-public`.
- **Errors**: 401 and 500 use the shared `{ error: string }` body. A 500 never carries raw error text (CLAUDE.md → API conventions).

## What is not in it

- **Staff, admin, cron and dev routes** (`x-excluded` has the counts): everything under `/api/admin`, `/api/plan-builder`, `/api/cron` and `/api/dev`, and any route whose only gates are staff gates (`requireStaff*`, `requireAcademyManager`, `requireContentStaff`, `requireStoryAdmin`, `requireApprover`). `docs/api-routes.md` lists every route, these included.
- **Request and response field schemas.** The handlers don't declare them, so bodies are typed as plain JSON objects instead of made-up fields. Adding a zod schema per handler (#227 does this for 20 hot handlers) is the way to fill them in later.
- **Fine-grained authorization.** "Member" means the route needs a verified session. Whether a caller may act for a given athlete (self, coach or staff) is decided inside the handler; `docs/route-auth-inventory.md` covers that.

The audience is a heuristic over the gate calls in the route source. A route that calls both a staff gate and a member gate (for example, staff-only branches inside a member route) is listed as member.
