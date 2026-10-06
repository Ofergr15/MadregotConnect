import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The move's cron kill switch (lib/cron-pause.ts) only works if EVERY cron asks
 * it first. A new cron that skips it would keep running through the next
 * database move, against a frozen database or behind maintenance.
 */
const DIR = new URL('../app/api/cron/', import.meta.url);

describe('every cron honours cron_paused', () => {
  const crons = readdirSync(DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  it('finds the crons', () => expect(crons.length).toBeGreaterThanOrEqual(8));
  it.each(crons)('%s checks cronPaused() before doing anything', (name) => {
    const src = readFileSync(new URL(`${name}/route.ts`, DIR), 'utf8');
    expect(src).toMatch(/async function (run|runSync)\(request: (Request|NextRequest)\)[^{]*\{\n\s+if \(await cronPaused\(\)\) return NextResponse\.json\(\{ paused: true \}\);/);
  });
  it('every cron in vercel.json has a route that checks it', () => {
    const cfg = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) as { crons: Array<{ path: string }> };
    for (const c of cfg.crons) expect(crons).toContain(c.path.replace('/api/cron/', ''));
  });
});
