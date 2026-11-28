// Task 80: migration 223 drops anon SELECT on storage.objects. That is safe only while every
// storage call runs on the service role (server side). Fails if a client file touches .storage.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'src');
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === '__tests__' || name === 'node_modules') continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const files = walk(ROOT).map((p) => ({ p: p.slice(ROOT.length + 1), src: readFileSync(p, 'utf8') }));
const usesStorage = (s: string) => /\.storage\s*\.\s*(from|getBucket|createBucket|listBuckets)\b|\.storage\s*$/m.test(s);
const isClient = (s: string) => /^\s*['"]use client['"]/.test(s);

describe('storage is server-only (migration 223 safety)', () => {
  it('no client component or client module calls supabase.storage', () => {
    const bad = files.filter((f) => isClient(f.src) && usesStorage(f.src)).map((f) => f.p);
    expect(bad).toEqual([]);
  });
  it('the browser client module itself never touches storage', () => {
    const client = files.find((f) => f.p === join('lib', 'supabase', 'client.ts'));
    expect(client && usesStorage(client.src)).toBe(false);
  });
  it('every file that uses storage is listed in docs/storage-paths.md', () => {
    const doc = readFileSync(join(process.cwd(), 'docs', 'storage-paths.md'), 'utf8');
    expect(files.filter((f) => usesStorage(f.src)).length).toBeGreaterThan(15);
    const missing = files
      .filter((f) => usesStorage(f.src))
      .map((f) => f.p.replace(/^app\//, '').replace(/\/route\.ts$/, '').replace(/^lib\//, 'lib/'))
      .filter((key) => {
        const base = key.split('/').pop()!;
        return !doc.includes(key) && !doc.includes(base);
      });
    expect(missing).toEqual([]);
  });
});
