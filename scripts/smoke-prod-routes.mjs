#!/usr/bin/env node
/**
 * Release gate (QA 2026-11-28, Q28-1): every route the native app calls must EXIST in prod.
 * A b26 build talked to a production that had not been deployed for two days and got 404 on
 * /api/group-chat; nothing caught it. This does.
 *
 * Route list: src/lib/dev-api-allowlist.ts (DEV_API_ALLOWLIST) — the method + path pairs the
 * iOS app calls, each of which authenticates the caller itself. Requests are UNAUTHENTICATED:
 *   GET    → GET, no body. Any status but a missing-route 404 / 405 passes (401/403/400 fine).
 *   POST   → POST with an empty body. Same rule. A 2xx FAILS: an empty unauthenticated write
 *            must never succeed, and that would be worth knowing on its own.
 *   PUT / PATCH / DELETE → OPTIONS only (Next answers it from the route file without running
 *            the handler); passes when the Allow header lists the method. Nothing is changed.
 * A 404 with a JSON body is the handler answering ("no such row" for the placeholder id), so
 * the route exists; Next's missing-route 404 is HTML.
 *
 * Also checks GET /api/version reports EXPECTED_VERSION (the version of the commit shipped).
 *
 * env: SMOKE_BASE_URL (default https://www.madregot.app), EXPECTED_VERSION (optional),
 *      ALLOWLIST_PATH (default src/lib/dev-api-allowlist.ts)
 * Public logs: prints method, path and status only — never a response body.
 */
import { readFileSync } from 'node:fs';

const BASE = (process.env.SMOKE_BASE_URL || 'https://www.madregot.app').replace(/\/$/, '');
const FILE = process.env.ALLOWLIST_PATH || 'src/lib/dev-api-allowlist.ts';
const EXPECTED_VERSION = process.env.EXPECTED_VERSION || '';
const PLACEHOLDER = '00000000-0000-0000-0000-000000000000';
const CONCURRENCY = 6;

export function parseAllowlist(src) {
  const start = src.indexOf('DEV_API_ALLOWLIST:');
  if (start < 0) throw new Error('DEV_API_ALLOWLIST not found');
  const block = src.slice(start, src.indexOf('];', start));
  return [...block.matchAll(/\[\s*'([A-Z]+)'\s*,\s*'([^']+)'\s*\]/g)].map((m) => [m[1], m[2]]);
}

export const concretePath = (pattern) => pattern.split('/').map((s) => (s === '*' ? PLACEHOLDER : s)).join('/');

/**
 * 'ok' | reason.
 * @param {string} method
 * @param {{ status: number, contentType?: string | null, allow?: string | null }} res
 */
export function judge(method, { status, contentType, allow }) {
  if (method === 'GET' || method === 'POST') {
    if (status === 404 && !/json/i.test(contentType || '')) return 'missing route (404)';
    if (status === 405) return 'method not exported (405)';
    // A POST to a missing /api path falls through to the HTML page shell with a 200.
    if (method === 'POST' && status < 300 && !/json/i.test(contentType || '')) return 'missing route (HTML fallback)';
    if (method === 'POST' && status >= 200 && status < 300) return `unauthenticated empty POST succeeded (${status})`;
    if (status >= 500) return 'ok-5xx'; // exists; a 5xx is the regular smoke's business
    return 'ok';
  }
  const methods = (allow || '').split(',').map((s) => s.trim().toUpperCase());
  if (status >= 200 && status < 300 && methods.includes(method)) return 'ok';
  return `OPTIONS ${status}, Allow: ${allow || 'none'}`;
}

async function probe(method, pattern) {
  const url = `${BASE}${concretePath(pattern)}`;
  const init = method === 'GET' ? { method: 'GET' }
    : method === 'POST' ? { method: 'POST', body: '' }
      : { method: 'OPTIONS' };
  const r = await fetch(url, { ...init, redirect: 'manual' });
  await r.arrayBuffer().catch(() => null);
  return { status: r.status, contentType: r.headers.get('content-type'), allow: r.headers.get('allow') };
}

async function main() {
  const routes = parseAllowlist(readFileSync(FILE, 'utf8'));
  if (routes.length < 50) throw new Error(`only ${routes.length} routes parsed from ${FILE}`);
  const failures = [];
  let warn = 0;
  const queue = [...routes];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const [method, pattern] = item;
      let verdict;
      try { verdict = judge(method, await probe(method, pattern)); } catch (e) { verdict = `request failed: ${e.message}`; }
      if (verdict === 'ok-5xx') warn++;
      else if (verdict !== 'ok') failures.push(`${method} ${pattern}: ${verdict}`);
    }
  }));

  if (EXPECTED_VERSION) {
    try {
      const r = await fetch(`${BASE}/api/version`, { cache: 'no-store' });
      const v = (await r.json())?.version;
      if (v !== EXPECTED_VERSION) failures.push(`/api/version reports ${v}, shipped ${EXPECTED_VERSION}`);
    } catch (e) { failures.push(`/api/version unreadable: ${e.message}`); }
  }

  console.log(`${routes.length} native routes probed against ${BASE}; ${warn} answered 5xx (exist).`);
  if (failures.length) {
    console.log(`FAIL (${failures.length}):`);
    for (const f of failures.sort()) console.log(`  ${f}`);
    process.exit(1);
  }
  console.log('All native routes exist in prod' + (EXPECTED_VERSION ? `; version ${EXPECTED_VERSION} is live.` : '.'));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
