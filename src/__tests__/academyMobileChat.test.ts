import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import { chipFades } from '@/lib/academy/chip-row';
import { createOpenRetry } from '@/lib/academy/open-retry';
import { viewportBox } from '@/lib/academy/visual-viewport';
import { threadOwnsBackEntry } from '@/components/academy/AcademyThreads';
import { STAFF_TRANSCRIPT_CLASS } from '@/components/academy/AcademyThreadPanel';
import { SHEET_ROOT_CLASS } from '@/components/academy/ThreadTranscript';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const classes = (c: string) => c.split(/\s+/);

// Brief 2026-11-18 (mobile chat, 2.41.501).
describe('1.1 / 1.4 — the thread transcript is bounded in both modes', () => {
  it('the staff panel gives its transcript flex-1 min-h-0', () => {
    expect(classes(STAFF_TRANSCRIPT_CLASS)).toEqual(expect.arrayContaining(['flex-1', 'min-h-0']));
    const panel = read('components/academy/AcademyThreadPanel.tsx');
    expect(panel).toMatch(/className=\{onBack \? cn\(STAFF_TRANSCRIPT_CLASS, className\) : className\}/);
  });
  it('a sheet transcript root fills its parent itself, whoever the caller is', () => {
    expect(classes(SHEET_ROOT_CLASS)).toEqual(expect.arrayContaining(['flex-1', 'min-h-0']));
    expect(read('components/academy/ThreadTranscript.tsx')).toMatch(/isSheet \? SHEET_ROOT_CLASS/);
  });
  it('the inner scroller is the flex-1 overflow box (long threads scroll on purpose)', () => {
    expect(read('components/academy/ThreadTranscript.tsx')).toMatch(/isSheet && 'min-h-0 flex-1 overflow-y-auto/);
  });
  it('the trainee sheet still bounds its transcript', () => {
    expect(read('components/trainee/TraineeBoard.tsx')).toMatch(/layout="sheet" className="min-h-0 flex-1"/);
  });
});

describe('1.3 — Back closes the thread to the list', () => {
  it('a thread opened from the inbox or a deep link owns a back entry', () => {
    expect(threadOwnsBackEntry('a1', null, false)).toBe(true);
    expect(threadOwnsBackEntry('a1', 'a1', false)).toBe(true);
    expect(threadOwnsBackEntry('b2', 'a1', true)).toBe(true);
  });
  it('none when closed, or when opened from a sheet that has its own way back', () => {
    expect(threadOwnsBackEntry(null, null, false)).toBe(false);
    expect(threadOwnsBackEntry('a1', 'a1', true)).toBe(false);
  });
  it('wires it through the shared useBackDismiss (pushState on open, popstate closes)', () => {
    const src = read('components/academy/AcademyThreads.tsx');
    expect(src).toMatch(/import \{ useBackDismiss \} from '@\/lib\/use-back-dismiss'/);
    expect(src).toMatch(/useBackDismiss\(threadOwnsBackEntry\(openId, initialOpenId, !!onExit\), close\)/);
    expect(src).not.toMatch(/history\.pushState|addEventListener\('popstate'/);
  });
});

describe('2.1 — one silent retry before the open error', () => {
  it('retries once with a short backoff, then gives up', () => {
    const log = vi.fn();
    const r = createOpenRetry({ delayMs: 500, log });
    expect(r.exhausted).toBe(false);
    expect(r.fail('open-thread', new Error('Load failed'))).toBe(500);
    expect(r.exhausted).toBe(true);
    expect(r.fail('stream-watch')).toBeNull();
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls.map((c) => c[1])).toEqual(['open-thread', 'stream-watch']);
  });
  it('the panel routes every open step through it and keeps the manual retry', () => {
    const src = read('components/academy/AcademyThreadPanel.tsx');
    for (const step of ['session', 'open-thread', 'stream-token', 'stream-watch']) expect(src).toContain(`'${step}'`);
    expect(src).toContain('<RetryButton onRetry={retry} />');
  });
});

describe('1.2 — the quick-reply row', () => {
  it('fades the edge that hides more chips', () => {
    // LTR scroller, first chip on the right: at rest it sits scrolled fully right.
    expect(chipFades(195, 565, 370)).toEqual({ end: true, start: false });
    expect(chipFades(0, 565, 370)).toEqual({ end: false, start: true });
    expect(chipFades(100, 565, 370)).toEqual({ end: true, start: true });
    expect(chipFades(0, 370, 370)).toEqual({ end: false, start: false });
  });
  it('uses the robust scroller: dir=ltr, reversed, rtl chips, touch scrolling', () => {
    const src = read('components/academy/ThreadTranscript.tsx');
    expect(src).toMatch(/dir="ltr"[^>]*data-testid="thread-chips"/);
    expect(src).toMatch(/\[...replies\].reverse\(\)/);
    expect(src).not.toMatch(/data-testid="thread-chips"\s+className="[^"]*flex-row-reverse/);
    expect(src).toMatch(/\[-webkit-overflow-scrolling:touch\]/);
    expect(src).toMatch(/data-testid="thread-chips-fade"/);
  });
});

describe('3.1 — the keyboard does not cover the staff composer', () => {
  it('uses the visual viewport box only while it differs from the window', () => {
    expect(viewportBox(844, { height: 844, offsetTop: 0 })).toBeNull();
    expect(viewportBox(844, null)).toBeNull();
    expect(viewportBox(844, { height: 508.4, offsetTop: 0 })).toEqual({ top: 0, height: 508 });
    expect(viewportBox(844, { height: 508, offsetTop: 120 })).toEqual({ top: 120, height: 508 });
  });
  it('the staff screen is 100dvh, and the global viewport meta is untouched', () => {
    const panel = read('components/academy/AcademyThreadPanel.tsx');
    expect(panel).toMatch(/fixed inset-x-0 top-0 z-\[60\] flex h-\[100dvh\]/);
    expect(read('app/layout.tsx')).not.toMatch(/interactive-widget/);
  });
});
