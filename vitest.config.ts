import { defineConfig } from 'vitest/config';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';

const alias = { '@': path.resolve(__dirname, './src') };

/**
 * Test speed (task 109). Two things keep `npm test` fast as the suite grows:
 *
 * 1. Worker threads, not forked processes: ~880 files each import their own module
 *    graph, and a thread starts and imports cheaper than a child process.
 *
 * 2. Files that cannot leak state run WITHOUT per-file isolation, so their imports
 *    are shared inside a worker instead of re-done per file. "Cannot leak" is decided
 *    from the source, every run: a file is shared only if it never touches `vi.`
 *    (mocks, spies, timers, stubs), `process.env`, globals, or the DOM. Anything else
 *    stays isolated exactly as before. A new test lands in the right pool by itself;
 *    to force a file into the isolated pool, put `// @isolate` anywhere in it.
 */
const LEAKY = /\bvi\.|process\.env|globalThis|\bwindow\b|localStorage|sessionStorage|\bdocument\b|@isolate|jsdom|happy-dom/;
const TEST_FILE = /\.(test|spec)\.tsx?$/;

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : testFiles(p);
    return TEST_FILE.test(e.name) ? [p] : [];
  });
}

const all = testFiles(path.resolve(__dirname, 'src'));
const shared = all.filter((f) => !LEAKY.test(readFileSync(f, 'utf8'))).map((f) => path.relative(__dirname, f));

export default defineConfig({
  resolve: { alias },
  test: {
    globals: true,
    pool: 'threads',
    // A single test slower than this is flagged in the reporter output.
    slowTestThreshold: 500,
    projects: [
      { extends: true, test: { name: 'isolated', include: ['src/**/*.{test,spec}.{ts,tsx}'], exclude: shared } },
      { extends: true, test: { name: 'shared', include: shared, isolate: false } },
    ],
  },
});
