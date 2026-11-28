import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { build, audience, publicRoutes } from '../../scripts/gen-openapi.mjs';

/**
 * docs/openapi.json (round 6, task 172) is generated from the route files.
 * These pin that it is current, structurally valid OpenAPI 3.1, and that no
 * staff / admin / cron route leaks into the public description.
 */

type Op = { operationId: string; security: Record<string, string[]>[]; parameters?: { name: string; in: string }[]; 'x-audience': string };
const file = readFileSync('docs/openapi.json', 'utf8');
const spec = JSON.parse(file) as { openapi: string; paths: Record<string, Record<string, Op>>; components: { securitySchemes: Record<string, unknown> } };
const ops = Object.entries(spec.paths).flatMap(([path, item]) => Object.entries(item).map(([method, op]) => ({ path, method, op })));

describe('docs/openapi.json', () => {
  it('is up to date — run `node scripts/gen-openapi.mjs` after changing a route', () => {
    expect(file === build()).toBe(true);
  });

  it('is OpenAPI 3.1 with unique operation ids', () => {
    expect(spec.openapi).toBe('3.1.0');
    const ids = ops.map((o) => o.op.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('declares every {path} parameter and only known security schemes', () => {
    const schemes = new Set(Object.keys(spec.components.securitySchemes));
    for (const { path, op } of ops) {
      const declared = (op.parameters ?? []).filter((p) => p.in === 'path').map((p) => p.name).sort();
      const inPath = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(declared, path).toEqual(inPath);
      for (const req of op.security) for (const s of Object.keys(req)) expect(schemes.has(s), `${path} ${s}`).toBe(true);
    }
  });

  it('leaves out admin, plan-builder, cron and dev routes', () => {
    expect(Object.keys(spec.paths).filter((p) => /^\/api\/(admin|plan-builder|cron|dev)(\/|$)/.test(p))).toEqual([]);
  });

  it('a route is public only if docs/route-auth-inventory.md allowlists it', () => {
    const allow = publicRoutes() as Map<string, unknown>;
    const pub = ops.filter((o) => o.op['x-audience'] === 'public').map((o) => o.path.replace(/\{(\w+)\}/g, '[$1]'));
    expect(pub.filter((p) => !allow.has(p))).toEqual([]);
    for (const o of ops) expect(o.op.security.length === 0, o.path).toBe(o.op['x-audience'] === 'public');
  });
});

describe('audience()', () => {
  const none = new Map();
  it.each([
    ['/api/admin/users', 'const x = await requireStaff(request);', 'staff'],
    ['/api/cron/sync', 'if (auth !== `Bearer ${process.env.CRON_SECRET}`)', 'cron'],
    ['/api/academy/home', 'await requireStaffCaller(request)', 'staff'],
    ['/api/academy/me', 'await requireCallerForAthlete(request, id)', 'member'],
    ['/api/device/activities', 'await requireDevice(request)', 'device'],
    ['/api/feed', 'await resolveVerifiedCaller(request); if (staff) await requireStaff(request)', 'member'],
  ])('%s → %s', (route, src, who) => expect(audience(route, src, none)).toBe(who === 'member' ? 'member' : who));
});
