import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { BUCKETS, SERVED_BUCKETS, fileRouteUrl, rewriteStorageUrls, servedObject, toFileRoute } from '@/lib/storage/buckets';

const SRC = fileURLToPath(new URL('..', import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' || e.name === 'preview' ? [] : files(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

describe('every bucket the code names is in lib/storage/buckets.ts', () => {
  it('storage.from / createBucket / *BUCKET* = names are all listed with a reason', () => {
    const PATTERNS = [
      /storage\s*\.from\(\s*['"`]([a-z0-9-]+)['"`]/g,
      /createBucket\(\s*['"`]([a-z0-9-]+)['"`]/g,
      /\b[A-Z_]*BUCKET\s*=\s*['"`]([a-z0-9-]+)['"`]/g,
      /\/storage\/v1\/object\/public\/([a-z0-9-]+)\//g,
    ];
    const unknown: string[] = [];
    for (const f of files(SRC)) {
      const s = readFileSync(f, 'utf8');
      for (const re of PATTERNS) {
        for (const m of s.matchAll(re)) if (!(m[1] in BUCKETS)) unknown.push(`${relative(SRC, f)}: ${m[1]}`);
      }
    }
    expect(unknown).toEqual([]);
    for (const [name, e] of Object.entries(BUCKETS)) {
      expect(e.reason.length, name).toBeGreaterThan(20);
      if (e.public) expect('serve' in e, name).toBe(false);
    }
  });

  it('migration 252 makes private exactly the buckets /api/files serves', () => {
    const sql = readFileSync(join(SRC, '../supabase/migrations/252_private_buckets.sql'), 'utf8');
    const update = sql.slice(sql.indexOf('UPDATE storage.buckets\n'));
    const ids = [...update.slice(0, update.indexOf(';')).matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]).sort();
    expect(ids).toEqual([...SERVED_BUCKETS].sort());
  });
});

describe('stored links → /api/files', () => {
  const tokyo = 'https://njzldypndkicpsmdtyll.supabase.co/storage/v1/object/public/avatars/ath-1/a.jpg?v=17';

  it('rewrites a served bucket on any project host, keeping the query', () => {
    expect(toFileRoute(tokyo)).toBe('/api/files/avatars/ath-1/a.jpg?v=17');
    expect(toFileRoute('https://eu.supabase.co/storage/v1/object/public/program-plans/training-program/w.pdf'))
      .toBe('/api/files/program-plans/training-program/w.pdf');
  });

  it('makes a route link on any host site-relative', () => {
    expect(toFileRoute('https://www.madregot.app/api/files/run-chat/x/laps.png?v=2')).toBe('/api/files/run-chat/x/laps.png?v=2');
  });

  it('leaves public buckets, other storage paths and foreign links alone', () => {
    for (const u of [
      'https://x.supabase.co/storage/v1/object/public/notification-images/n.png',
      'https://x.supabase.co/storage/v1/object/sign/avatars/a.jpg?token=t',
      'https://lh3.googleusercontent.com/a/photo.jpg',
      '/images/icon-192.png',
      '',
    ]) expect(toFileRoute(u)).toBe(u);
    expect(toFileRoute(null)).toBeNull();
    expect(toFileRoute(undefined)).toBeUndefined();
  });

  it('rewrites every link inside a JSON body', () => {
    const body = JSON.stringify([{ avatar_url: tokyo }, { media: [{ url: 'https://eu.supabase.co/storage/v1/object/public/feed-media/p/1.jpg' }] }]);
    expect(JSON.parse(rewriteStorageUrls(body))).toEqual([
      { avatar_url: '/api/files/avatars/ath-1/a.jpg?v=17' },
      { media: [{ url: '/api/files/feed-media/p/1.jpg' }] },
    ]);
  });

  it('fileRouteUrl encodes each segment once', () => {
    expect(fileRouteUrl('feed-media', 'a b/c#d.jpg')).toBe('/api/files/feed-media/a%20b/c%23d.jpg');
  });

  it('servedObject refuses public, unknown and own-route buckets and bad paths', () => {
    expect(servedObject('avatars', ['ath-1', 'a.jpg'])).toEqual({ bucket: 'avatars', access: 'member', path: 'ath-1/a.jpg' });
    for (const b of ['notification-images', 'face-crops', 'run-gpx', 'nope', '__proto__']) expect(servedObject(b, ['a.jpg'])).toBeNull();
    for (const p of [[], ['..', 'a'], ['a', ''], ['a\\b'], ['a\u0000']]) expect(servedObject('avatars', p)).toBeNull();
  });
});
