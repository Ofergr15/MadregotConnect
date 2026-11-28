#!/usr/bin/env node
// Regenerates docs/openapi.json — an OpenAPI 3.1 description of every PUBLIC and
// MEMBER route under src/app/api/**/route.ts (round 6, task 172).
//   node scripts/gen-openapi.mjs          → writes the file
//   node scripts/gen-openapi.mjs --check  → exits 1 if the file is stale
//
// What is in it: path, methods, path + query parameters, the auth scheme, a
// summary per method (the JSDoc right above the handler, else the file's first
// JSDoc), and the shared error body. What is NOT: request/response field
// schemas — the handlers don't declare them, so the spec says "JSON object"
// rather than invent fields. Staff-only, admin, cron and dev routes are left
// out on purpose (counted in x-excluded); docs/api-routes.md lists all of them.
//
// Audience comes from the same sources the auth invariant test uses:
//   public  = the allowlist table in docs/route-auth-inventory.md (minus /api/dev, /api/admin)
//   device  = calls requireDevice (Bearer wat1.… device token)
//   staff   = /api/admin, /api/plan-builder, or only staff gates and no member gate
//   cron    = /api/cron, /api/dev, or CRON_SECRET and no member gate
//   member  = everything else that resolves a verified session (Bearer JWT)
import { readFileSync, writeFileSync } from 'fs';
import { join, relative, sep } from 'path';
import { walk, purpose } from './gen-api-routes-doc.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const API = join(ROOT, 'src', 'app', 'api');
const OUT = join(ROOT, 'docs', 'openapi.json');
const INVENTORY = join(ROOT, 'docs', 'route-auth-inventory.md');

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const MEMBER_GATE = /\b(resolveVerifiedCaller|mayActFor|requireMember|requireCallerForAthlete|requirePackLeader|requireSession|requireAthlete|requireTraineeAccess|verifyRequest|loadPain)\b/;
const STAFF_GATE = /\b(requireStaff\w*|requireAdmin\w*|requireAcademyManager|requireContentStaff|requireStoryAdmin|requireApprover)\b/;
const CRON = /CRON_SECRET|isAuthorizedCron/;

/** The "Routes reachable without a session" table → route → why it is safe. */
export function publicRoutes(md = readFileSync(INVENTORY, 'utf8')) {
  const start = md.indexOf('## Routes reachable without a session');
  const end = md.indexOf('\n## ', start + 1);
  const out = new Map();
  for (const m of md.slice(start, end).matchAll(/^\| `(\/api\/[^`]+)` \| ([^|]+) \| ([^|]+) \|$/gm)) {
    out.set(m[1], { kind: m[2].trim(), why: m[3].trim() });
  }
  return out;
}

export function audience(route, src, publics) {
  // Path rules first: /api/dev and /api/admin/login are on the public allowlist but
  // are not part of the API anyone outside the staff should build against.
  if (/^\/api\/(cron|dev)\//.test(route)) return 'cron';
  if (/^\/api\/(admin|plan-builder)(\/|$)/.test(route)) return 'staff';
  if (publics.has(route)) return 'public';
  if (CRON.test(src) && !MEMBER_GATE.test(src)) return 'cron';
  if (/\brequireDevice\b/.test(src)) return 'device';
  if (STAFF_GATE.test(src) && !MEMBER_GATE.test(src)) return 'staff';
  return 'member';
}

function oneLine(doc) {
  let text = doc.split('\n').map((l) => l.replace(/^\s*\*\s?/, '').trim()).filter(Boolean).join(' ');
  text = text.replace(/`/g, '').replace(/\s+/g, ' ').trim();
  const cut = text.search(/(?<=[.!?])\s/);
  text = cut > 0 ? text.slice(0, cut) : text;
  return text.length > 200 ? `${text.slice(0, 197)}…` : text;
}

/** The JSDoc block directly above `export async function GET` etc. */
function methodDocs(src) {
  const out = {};
  const re = /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*export (?:async function|function|const) (GET|POST|PUT|PATCH|DELETE)\b/g;
  for (const m of src.matchAll(re)) out[m[2]] = oneLine(m[1]);
  return out;
}

function operationId(method, route) {
  const words = route.replace(/^\/api\//, '').split(/[/\-_]/).filter(Boolean)
    .map((w) => w.replace(/^\{(.+)\}$/, 'by-$1').replace(/[^\w]/g, ''))
    .flatMap((w) => w.split('-'))
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return method.toLowerCase() + words.join('');
}

const SECURITY = { public: [], member: [{ bearerAuth: [] }], device: [{ deviceToken: [] }] };

export function build() {
  const publics = publicRoutes();
  const paths = {};
  const excluded = { staff: 0, cron: 0 };
  for (const f of walk(API).sort()) {
    const src = readFileSync(f, 'utf8');
    const dir = relative(API, f).split(sep).slice(0, -1);
    const route = '/api/' + dir.join('/');
    const who = audience(route, src, publics);
    if (who === 'staff' || who === 'cron') { excluded[who] += 1; continue; }
    const methods = METHODS.filter((m) => new RegExp(`export (?:async function|function|const) ${m}\\b`).test(src));
    if (!methods.length) continue;
    const pathParams = dir.filter((d) => /^\[[^.\]]+\]$/.test(d)).map((d) => d.slice(1, -1));
    const query = [...new Set([...src.matchAll(/searchParams\.get\(\s*['"]([\w.-]+)['"]\s*\)/g)].map((m) => m[1]))].sort();
    const docs = methodDocs(src);
    const fallback = purpose(src);
    const oaPath = '/api/' + dir.map((d) => (/^\[[^.\]]+\]$/.test(d) ? `{${d.slice(1, -1)}}` : d)).join('/');
    const item = {};
    for (const m of methods) {
      const parameters = [
        ...pathParams.map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } })),
        ...(m === 'GET' || m === 'DELETE' ? query.map((name) => ({ name, in: 'query', schema: { type: 'string' } })) : []),
      ];
      const op = {
        operationId: operationId(m, oaPath),
        tags: [dir[0]],
        summary: docs[m] || fallback || `${m} ${route}`,
        ...(parameters.length ? { parameters } : {}),
        ...(['POST', 'PUT', 'PATCH'].includes(m) ? { requestBody: { content: { 'application/json': { schema: { type: 'object' } } } } } : {}),
        security: SECURITY[who],
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } },
          ...(who === 'public' ? {} : { 401: { $ref: '#/components/responses/Unauthorized' } }),
          500: { $ref: '#/components/responses/ServerError' },
        },
        'x-audience': who,
        ...(who === 'public' ? { 'x-why-public': publics.get(route).why } : {}),
      };
      item[m.toLowerCase()] = op;
    }
    paths[oaPath] = item;
  }
  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'MadregotConnect API — public and member routes',
      // Not package.json's version: that moves on every release and would make the file stale.
      version: '1',
      description: 'Generated by scripts/gen-openapi.mjs from src/app/api/**/route.ts. Do not edit by hand. Staff, admin, cron and dev routes are not included (see docs/api-routes.md); request/response field schemas are not declared by the handlers and are left as JSON objects. Hebrew is the default locale of every message string.',
    },
    servers: [{ url: 'https://www.madregot.app' }],
    'x-excluded': excluded,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Supabase access token of the signed-in member' },
        deviceToken: { type: 'http', scheme: 'bearer', description: 'Paired watch/companion token (wat1.…), from POST /api/device/token' },
      },
      schemas: { Error: { type: 'object', required: ['error'], properties: { error: { type: 'string' } } } },
      responses: {
        Unauthorized: { description: 'No or invalid session', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        ServerError: { description: 'Server error; the body never carries raw error text', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    },
    paths,
  };
  return format(spec);
}

/** Pretty at the top, one line per path, so a route change is a one-line diff. */
function format(spec) {
  const { paths, ...head } = spec;
  const top = JSON.stringify(head, null, 2).replace(/\n\}$/, '');
  const lines = Object.entries(paths).map(([p, item]) => `    ${JSON.stringify(p)}: ${JSON.stringify(item)}`);
  return `${top},\n  "paths": {\n${lines.join(',\n')}\n  }\n}\n`;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(sep).pop())) {
  const json = build();
  if (process.argv.includes('--check')) {
    const cur = (() => { try { return readFileSync(OUT, 'utf8'); } catch { return ''; } })();
    if (cur !== json) { console.error('docs/openapi.json is stale: run node scripts/gen-openapi.mjs'); process.exit(1); }
  } else {
    writeFileSync(OUT, json);
    const n = Object.keys(JSON.parse(json).paths).length;
    console.log(`wrote ${relative(ROOT, OUT)} (${n} paths)`);
  }
}
