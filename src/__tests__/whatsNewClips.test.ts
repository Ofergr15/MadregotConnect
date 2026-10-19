import { describe, expect, it } from 'vitest';
import { existsSync } from 'fs';
import { applyPick, releaseEntries, BUNDLED_NOTES, type ReleaseNote, type WhatsNewRelease } from '@/lib/release-notes';
import { weeksOf } from '@/components/whats-new/WhatsNewWeeks';

const note = (id: string, extra: Partial<ReleaseNote> = {}): ReleaseNote =>
  ({ id, date: '2026-10-19', kind: 'feature', icon: '☀️', title: id, body: '', ...extra });

describe('a release note with a demo (2026-10-19)', () => {
  it('is starred unless the owner says otherwise', () => {
    expect(applyPick(note('a', { media: 'a.mp4' }), undefined).featured).toBe(true);
    expect(applyPick(note('b'), undefined).featured).toBe(false);
    expect(applyPick(note('a', { media: 'a.mp4' }), { note_id: 'a', featured: false, title: null, body: null } as never).featured).toBe(false);
  });
  it('carries its clip and still into the sheet', () => {
    const r: WhatsNewRelease = { id: 1, released_at: '2026-10-20T02:00:00Z', app_version: '2.41.1', notes: [{ ...applyPick(note('a', { media: 'a.mp4', poster: 'a.jpg' }), undefined) }] } as WhatsNewRelease;
    expect(releaseEntries([r], '2.41.9')[0].media).toEqual({ src: '/whats-new/a.mp4', poster: '/whats-new/a.jpg' });
  });
  it('points at files that exist', () => {
    for (const n of BUNDLED_NOTES.filter((x) => x.media)) {
      expect(existsSync(`public/whats-new/${n.media}`)).toBe(true);
      if (n.poster) expect(existsSync(`public/whats-new/${n.poster}`)).toBe(true);
    }
  });
});

describe('what\'s new by week', () => {
  it('groups releases into Sunday weeks, newest first, the demos first', () => {
    const rel = (at: string, notes: ReleaseNote[]) => ({ id: 0, released_at: at, app_version: '1', notes: notes.map((n) => applyPick(n, undefined)) }) as WhatsNewRelease;
    const w = weeksOf([rel('2026-10-19T03:00:00Z', [note('plain'), note('clip', { media: 'c.mp4' })]), rel('2026-10-13T03:00:00Z', [note('old')])]);
    expect(w.map((x) => x.start)).toEqual(['2026-10-18', '2026-10-11']);
    expect(w[0].notes.map((n) => n.id)).toEqual(['clip', 'plain']);
  });
});
