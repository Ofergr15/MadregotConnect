import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatServerTiming, recordTiming, sanitizeMetricName, timeStep, withServerTiming } from '@/lib/perf/server-timing';

const HOT_ROUTES = ['athletes/me', 'feed', 'dashboard/weekly', 'academy/segments', 'activities/analysis', 'activities/details', 'auth/me'];

describe('Server-Timing', () => {
  it('adds auth + total phases to the wrapped handler response', async () => {
    const GET = withServerTiming(async () => {
      await timeStep('auth', async () => 1);
      recordTiming('db', 12.34);
      return Response.json({ ok: true });
    });
    const res = await GET();
    const h = res.headers.get('Server-Timing')!;
    expect(h).toMatch(/^auth;dur=\d+\.\d, db;dur=12\.3, total;dur=\d+\.\d$/);
  });

  it('carries names and durations only — no desc, no request-derived value', async () => {
    const email = 'runner@example.com';
    const GET = withServerTiming(async (req: Request) => {
      recordTiming(new URL(req.url).searchParams.get('email')!, 5);
      return Response.json({ email });
    });
    const h = (await GET(new Request(`http://x/api?email=${email}`))).headers.get('Server-Timing')!;
    expect(h).not.toContain('@');
    expect(h).not.toContain('desc');
    expect(h).not.toContain('"');
    for (const part of h.split(', ')) expect(part).toMatch(/^[a-z0-9_-]+;dur=[\d.]+$/);
  });

  it('sanitises metric names', () => {
    expect(sanitizeMetricName('a b;desc="x"')).toBe('abdescx');
    expect(sanitizeMetricName('@@')).toBe('step');
    expect(formatServerTiming([{ name: 'X', dur: -1 }])).toBe('x;dur=0.0');
  });

  it('is a no-op outside a timed request', async () => {
    expect(await timeStep('auth', async () => 7)).toBe(7);
    recordTiming('db', 1); // must not throw
  });

  it('keeps concurrent requests apart', async () => {
    const GET = withServerTiming(async (n: number) => {
      await new Promise((r) => setTimeout(r, n));
      recordTiming(`r${n}`, n);
      return new Response('');
    });
    const [a, b] = await Promise.all([GET(5), GET(1)]);
    expect(a.headers.get('Server-Timing')).toMatch(/^r5;/);
    expect(b.headers.get('Server-Timing')).toMatch(/^r1;/);
  });

  it.each(HOT_ROUTES)('%s GET is wrapped', (r) => {
    const src = readFileSync(join(process.cwd(), 'src/app/api', r, 'route.ts'), 'utf8');
    expect(src).toContain('export const GET = withServerTiming(handleGET)');
  });
});
