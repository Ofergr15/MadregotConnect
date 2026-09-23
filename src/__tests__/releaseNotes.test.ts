import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUNDLED_NOTES, applyPick, isSha, releaseEntries, shownNotes, splitByApproval, unreleased,
  type ReleaseNote, type WhatsNewRelease,
} from '@/lib/release-notes';
import { initLedger, readWhatsNewLedger, unseenEntries } from '@/lib/whats-new/ledger';

const note = (id: string, extra: Partial<ReleaseNote> = {}): ReleaseNote => ({
  id, date: '2026-09-23', kind: 'feature', icon: '⚡', title: `t-${id}`, body: `b-${id}`, ...extra,
});

describe('release notes file', () => {
  it('ids are unique and every href is a real page', () => {
    const ids = BUNDLED_NOTES.map(n => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const n of BUNDLED_NOTES) {
      expect(['feature', 'fix']).toContain(n.kind);
      expect(n.title.length, n.id).toBeLessThanOrEqual(80);
      if (n.href) expect(existsSync(join(__dirname, '..', 'app/(app)', n.href, 'page.tsx')), n.href).toBe(true);
    }
    expect(existsSync(join(__dirname, '..', 'app/(app)/dashboard/whats-new/page.tsx'))).toBe(true);
  });
});

describe('unreleased', () => {
  it('is what no earlier release carried', () => {
    const notes = [note('a'), note('b'), note('c')];
    expect(unreleased(notes, [{ note_ids: ['a'] }, { note_ids: ['c'] }]).map(n => n.id)).toEqual(['b']);
  });
});

describe('applyPick', () => {
  it('nothing is featured until the owner stars it — features included', () => {
    expect(applyPick(note('a'), undefined).featured).toBe(false);
    expect(applyPick(note('a', { kind: 'fix' }), undefined).featured).toBe(false);
    expect(applyPick(note('a'), { note_id: 'a', featured: true, title: null, body: null }).featured).toBe(true);
  });

  it('takes the owner\'s wording, and blank wording falls back', () => {
    const p = applyPick(note('a'), { note_id: 'a', featured: false, title: 'Mine', body: '  ' });
    expect(p).toMatchObject({ title: 'Mine', body: 'b-a', featured: false, edited: true });
  });
});

describe('shownNotes', () => {
  it('hides staff-only notes from members, keeps the release order', () => {
    const notes = [note('a'), note('s', { audience: 'staff' }), note('b')];
    expect(shownNotes(['b', 's', 'a'], notes, [], { staff: false }).map(n => n.id)).toEqual(['b', 'a']);
    expect(shownNotes(['b', 's', 'a'], notes, [], { staff: true }).map(n => n.id)).toEqual(['b', 's', 'a']);
  });

  it('drops an id the file no longer has instead of throwing', () => {
    expect(shownNotes(['gone'], [note('a')], [], { staff: true })).toEqual([]);
  });
});

describe('releaseEntries → the What\'s new sheet', () => {
  const rel = (id: number, v: string, at: string, notes: ReleaseNote[], featured: boolean[]): WhatsNewRelease => ({
    id, app_version: v, released_at: at,
    notes: notes.map((n, i) => ({ ...n, featured: featured[i], edited: false })),
  });
  const releases = [
    rel(2, '2.41.3', '2026-09-24T02:05:00Z', [note('x'), note('fix1', { kind: 'fix' })], [true, false]),
    rel(1, '2.41.0', '2026-09-23T02:05:00Z', [note('y', { href: '/dashboard/review' })], [true]),
  ];

  it('only featured notes, only releases this bundle has, dated by Israel day', () => {
    const e = releaseEntries(releases, '2.41.0');
    expect(e.map(x => x.slug)).toEqual(['release:y']);
    expect(e[0]).toMatchObject({ publishedAt: '2026-09-23', href: '/dashboard/review', icon: '⚡' });
    expect(releaseEntries(releases, '2.41.3').map(x => x.slug)).toEqual(['release:x', 'release:y']);
  });

  it('a note with no page points at the release history', () => {
    expect(releaseEntries(releases, '2.41.3')[0].href).toBe('/dashboard/whats-new');
  });

  it('lives by the ledger: nothing for a device newer than the release, once for the rest', () => {
    const entries = releaseEntries(releases, '2.41.3');
    const fresh = initLedger(readWhatsNewLedger(null), '2026-09-24', false);
    expect(unseenEntries(entries, fresh)).toEqual([]);
    const returning = initLedger(readWhatsNewLedger(null), '2026-09-24', true);
    expect(unseenEntries(entries, returning).map(x => x.slug)).toEqual(['release:x', 'release:y']);
    expect(unseenEntries(entries, { ...returning, seen: ['release:x', 'release:y'] })).toEqual([]);
  });
});

describe('the approval gate', () => {
  it('splits waiting notes into approved and arrived-after', () => {
    const pending = [note('a'), note('b'), note('c')];
    expect(splitByApproval(pending, null)).toEqual({ approved: [], waiting: pending });
    const s = splitByApproval(pending, { note_ids: ['a', 'c'] });
    expect(s.approved.map(n => n.id)).toEqual(['a', 'c']);
    expect(s.waiting.map(n => n.id)).toEqual(['b']);
  });

  it('only a full commit hash is approvable', () => {
    expect(isSha('f3210b02')).toBe(false);
    expect(isSha('main')).toBe(false);
    expect(isSha('73defbd9e2f820523b0b4a46558dfc55e94cc91d')).toBe(true);
  });

  it('the 05:00 workflow ships only the approved commit', async () => {
    const { readFileSync } = await import('node:fs');
    const wf = readFileSync(join(__dirname, '../../.github/workflows/daily-release.yml'), 'utf8');
    expect(wf).toMatch(/api\/release\/approved/);
    expect(wf).toMatch(/git push origin "\$SHA:refs\/heads\/production"/);
    expect(wf).not.toMatch(/origin\/main:refs/);
  });
});
