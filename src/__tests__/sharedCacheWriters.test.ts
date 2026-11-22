import { describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const revalidateTag = vi.fn();
vi.mock('next/cache', () => ({
  revalidateTag: (...a: unknown[]) => revalidateTag(...a),
  // Outside Next there is no incremental cache — exercise the read-through fallback.
  unstable_cache: () => async () => { throw new Error('Invariant: incrementalCache missing in unstable_cache'); },
}));

const { SHARED_TABLES, SHARED_TAGS, invalidateShared, sharedCache } = await import('@/lib/cache/shared');

const TAG_KEY: Record<string, string> = Object.fromEntries(Object.entries(SHARED_TAGS).map(([k, v]) => [v, k]));

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f === '__tests__' || f === 'node_modules') continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(f)) out.push(p);
  }
  return out;
}

/** Every `.from('<cached table>')…insert|update|upsert|delete(` statement in src/. */
function writeSites() {
  const tables = Object.keys(SHARED_TABLES).join('|');
  const from = new RegExp(`\\.from\\(\\s*['"](${tables})['"]\\s*\\)`, 'g');
  const sites: Array<{ file: string; table: string; line: number; after: string }> = [];
  for (const file of walk(join(process.cwd(), 'src'))) {
    const s = readFileSync(file, 'utf8');
    for (const m of s.matchAll(from)) {
      const end = m.index! + m[0].length;
      const stmt = s.slice(end, end + 600).split(/;\s*\n/)[0];
      if (!/^\s*\.(insert|update|upsert|delete)\(/.test(stmt)) continue;
      // The invalidation must follow the write closely — the next ~15 lines.
      const after = s.slice(end).split('\n').slice(0, 15).join('\n');
      sites.push({ file: file.replace(process.cwd() + '/', ''), table: m[1], line: s.slice(0, m.index).split('\n').length, after });
    }
  }
  return sites;
}

describe('shared cache: every writer invalidates', () => {
  const sites = writeSites();

  it('finds the known writers (the scan itself works)', () => {
    const files = new Set(sites.map((s) => s.file));
    for (const f of [
      'src/app/api/program-weeks/route.ts', 'src/app/api/cron/tick/route.ts',
      'src/app/api/events/route.ts', 'src/app/api/events/[id]/route.ts', 'src/app/api/events/[id]/publish/route.ts',
      'src/app/api/club-updates/route.ts', 'src/app/api/club-updates/[id]/route.ts', 'src/lib/club-updates/server.ts',
    ]) expect(files, f).toContain(f);
  });

  it.each(sites.map((s) => [`${s.file}:${s.line} (${s.table})`, s] as const))('%s revalidates its tag', (_n, s) => {
    const key = TAG_KEY[SHARED_TABLES[s.table]];
    expect(s.after, `${s.file}:${s.line} writes ${s.table} without invalidateShared(SHARED_TAGS.${key})`)
      .toContain(`invalidateShared(SHARED_TAGS.${key})`);
  });

  it('never caches a personal table', () => {
    for (const t of ['athletes', 'athlete_activities', 'activity_streams', 'feed_items', 'notifications', 'event_registrations', 'weekly_km_snapshots', 'athlete_favorites']) {
      expect(Object.keys(SHARED_TABLES)).not.toContain(t);
    }
  });
});

describe('invalidateShared / sharedCache', () => {
  it('drops the tag with expire: 0 so the next read is fresh', () => {
    invalidateShared(SHARED_TAGS.events);
    expect(revalidateTag).toHaveBeenCalledWith('events', { expire: 0 });
  });
  it('never throws on a write path', () => {
    revalidateTag.mockImplementationOnce(() => { throw new Error('outside request'); });
    expect(() => invalidateShared(SHARED_TAGS.clubUpdates)).not.toThrow();
  });
  it('reads through outside the Next runtime', async () => {
    const fn = sharedCache(async (n: number) => n * 2, ['t'], { tag: SHARED_TAGS.events, revalidate: 60 });
    expect(await fn(21)).toBe(42);
  });
});
