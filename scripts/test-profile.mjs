#!/usr/bin/env node
/**
 * npm run test:profile — runs the unit suite once with vitest's JSON reporter and
 * prints the slowest test files and tests (task 109). Use it when `npm test`
 * starts to drag: the first rows are where the time went.
 *
 *   npm run test:profile            # top 15
 *   npm run test:profile -- 30      # top 30
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const top = Number(process.argv[2]) || 15;
const out = join(tmpdir(), `vitest-profile-${process.pid}.json`);
const t0 = Date.now();
const run = spawnSync('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${out}`], { stdio: ['ignore', 'ignore', 'inherit'] });
const wall = (Date.now() - t0) / 1000;

const report = JSON.parse(readFileSync(out, 'utf8'));
const files = report.testResults.map((f) => ({
  file: f.name.replace(`${process.cwd()}/`, ''),
  ms: f.endTime - f.startTime,
  tests: f.assertionResults.map((a) => ({ title: a.fullName || a.title, ms: a.duration ?? 0 })),
}));
const tests = files.flatMap((f) => f.tests.map((t) => ({ ...t, file: f.file })));
const pad = (n) => String(Math.round(n)).padStart(6);

console.log(`\n${report.numTotalTests} tests in ${files.length} files, ${wall.toFixed(1)} s wall (exit ${run.status})\n`);
console.log(`Slowest files (ms, body + in-test imports):`);
for (const f of files.sort((a, b) => b.ms - a.ms).slice(0, top)) console.log(`${pad(f.ms)}  ${f.file}`);
console.log(`\nSlowest tests (ms):`);
for (const t of tests.sort((a, b) => b.ms - a.ms).slice(0, top)) console.log(`${pad(t.ms)}  ${t.file} › ${t.title.slice(0, 90)}`);
process.exit(run.status ?? 1);
