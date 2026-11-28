import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, relative, sep } from 'path';
import { fileURLToPath } from 'url';

/**
 * Task 108 — every error response from app/api is the CLAUDE.md shape: JSON with a string `error`.
 *
 * 1. Every `NextResponse.json({...}, { status: 4xx|5xx })` object literal has an `error` key
 *    (extra keys like `code`, `allowed`, `tableMissing` may ride along — clients read those).
 * 2. A 500 that puts a raw `.message` in `error` leaks Postgres / SDK text (table names, member
 *    ids — see #175). Those are ratcheted: the count may only go DOWN. Fix one by logging the
 *    error and returning `internalErrorBody('…')` (src/lib/api-error.ts), then lower the number.
 */
const API = fileURLToPath(new URL('../app/api', import.meta.url));
const RAW_MESSAGE_500_BASELINE = 115;

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? routeFiles(p) : e.name === 'route.ts' ? [p] : [];
  });
}

interface ErrorLiteral { file: string; line: number; status: number; body: string }

/** Object-literal bodies of NextResponse.json(..., { status: NNN }) with NNN >= 400. */
export function errorLiterals(file: string, src: string): ErrorLiteral[] {
  const out: ErrorLiteral[] = [];
  const re = /NextResponse\.json\(\s*\{/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const start = m.index + m[0].length - 1;
    let depth = 0;
    let end = start;
    for (; end < src.length; end++) {
      if (src[end] === '{') depth++;
      else if (src[end] === '}' && --depth === 0) break;
    }
    const status = /^\s*,\s*\{\s*status:\s*(\d{3})/.exec(src.slice(end + 1, end + 80));
    if (!status || Number(status[1]) < 400) continue;
    out.push({ file: relative(API, file).split(sep).join('/'), line: src.slice(0, m.index).split('\n').length, status: Number(status[1]), body: src.slice(start, end + 1) });
  }
  return out;
}

const literals = routeFiles(API).flatMap((f) => errorLiterals(f, readFileSync(f, 'utf8')));

describe('error response shape ratchet', () => {
  it('the scanner sees error literals and their status', () => {
    expect(errorLiterals('x', "return NextResponse.json({ ok: false }, { status: 403 });")).toHaveLength(1);
    expect(errorLiterals('x', "return NextResponse.json({ items: [] }, { status: 200 });")).toHaveLength(0);
    expect(literals.length).toBeGreaterThan(500);
  });

  it('every 4xx/5xx JSON body has an `error` key', () => {
    const missing = literals.filter((l) => !/(^|[{,\s])error\s*[:,}]/.test(l.body)).map((l) => `${l.file}:${l.line} ${l.status}`);
    expect(missing).toEqual([]);
  });

  it(`raw .message in a 5xx body does not grow past ${RAW_MESSAGE_500_BASELINE}`, () => {
    const raw = literals.filter((l) => l.status >= 500 && /error\s*:\s*[^,}]*\.message/.test(l.body));
    expect(raw.length).toBeLessThanOrEqual(RAW_MESSAGE_500_BASELINE);
  });
});
