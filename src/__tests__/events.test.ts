import { describe, expect, it } from 'vitest';
import { EVENT_KINDS, EVENT_KIND_LABELS, isEventKind } from '@/lib/events';

describe('isEventKind', () => {
  it('accepts every real kind', () => {
    for (const kind of EVENT_KINDS) expect(isEventKind(kind)).toBe(true);
  });

  it('rejects an unrelated string', () => {
    expect(isEventKind('meeting')).toBe(false);
  });

  it('rejects non-string values without throwing', () => {
    expect(isEventKind(null)).toBe(false);
    expect(isEventKind(42)).toBe(false);
    expect(isEventKind(undefined)).toBe(false);
  });
});

describe('EVENT_KIND_LABELS', () => {
  it('has exactly one label per kind — no kind missing, no stale extra entry left behind if a kind is ever removed', () => {
    expect(Object.keys(EVENT_KIND_LABELS).sort()).toEqual([...EVENT_KINDS].sort());
  });

  it('every label is non-empty', () => {
    for (const kind of EVENT_KINDS) {
      expect(EVENT_KIND_LABELS[kind].trim().length).toBeGreaterThan(0);
    }
  });
});
