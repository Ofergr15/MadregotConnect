import { describe, expect, it } from 'vitest';
import { unstarredForMembers, type WhatsNewRelease } from '@/lib/release-notes';

const note = (id: string, featured = false, audience?: 'staff' | 'all') => ({ id, date: '2026-10-01', kind: 'fix', title: id, body: '', audience, featured, edited: false }) as any;
const rel = (day: string, notes: any[]): WhatsNewRelease => ({ id: 1, released_at: `${day}T10:00:00Z`, app_version: 'x', notes });

describe('unstarredForMembers', () => {
  it('counts member notes after the last starred release, not staff ones', () => {
    const r = unstarredForMembers([
      rel('2026-10-11', [note('a'), note('s', false, 'staff')]),
      rel('2026-10-06', [note('b')]),
      rel('2026-09-30', [note('starred', true), note('old')]),
    ]);
    expect(r.notes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(r.since).toBe('2026-09-30T10:00:00Z');
  });
  it('nothing waiting when the newest member note is starred', () => {
    expect(unstarredForMembers([rel('2026-10-11', [note('a', true)])]).notes).toEqual([]);
  });
});
