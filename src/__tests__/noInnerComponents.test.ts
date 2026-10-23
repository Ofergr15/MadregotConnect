import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A component declared INSIDE another component (`const Avatar = (…) => <img …/>` in a
 * function body) is a new type on every render, so React unmounts and remounts it — every
 * image reloads, every switch loses its animation. That was the coach-pulse "flicker"
 * (Ofer 2026-10-23). Declare components at module level, or call a render helper as a
 * plain function (`{row(…)}`), never as `<Row/>`.
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx$/.test(f) ? [p] : [];
  });
}

describe('no component declared inside a component', () => {
  it('has no indented `const Capitalised = (…) =>` or `function Capitalised(`', () => {
    const bad: string[] = [];
    for (const f of [...files('src/components'), ...files('src/app')]) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (/^\s{2,}const [A-Z][A-Za-z0-9]* = \((\{|props|\))[^=]*=>/.test(line) || /^\s{2,}function [A-Z][A-Za-z0-9]*\(/.test(line)) bad.push(`${f}:${i + 1}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
