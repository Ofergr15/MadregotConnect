import { describe, expect, it } from 'vitest';
import {
  cheerWaiting, isLocked, photosWaiting, postsOf, resultChips, shapePostResults, surveyWaiting, weekFolders,
  type FolderProposal, type MadeFolder, type PublishedPost,
} from '@/lib/content/hub';

// Content v4 (Ofer 10-20): each kind in its own block, each post with its own
// numbers, and the week's photo folders as one list — opened ones locked.

const post = (o: Partial<PublishedPost>): PublishedPost => ({
  id: 'p', kind: 'message', text: 't', at: '2026-10-20T08:00:00Z', likes: 0, comments: 0, answers: null, delivered: null, emoji: '📣', ...o,
});
const made = (date: string): MadeFolder => ({ date, name: `n${date}`, link: 'l', manual: false, autoFeed: true, photos: 0, inFeed: false });
const prop = (date: string, o: Partial<FolderProposal> = {}): FolderProposal => ({
  date, name: `p${date}`, workout: null, kind: 'quality', tags: [], createsAt: `${date}T06:00`, enabled: true, source: 'plan', ...o,
});

describe('the week\'s folders: opened is locked, upcoming is editable', () => {
  it('one list by date, from the week\'s Sunday', () => {
    const rows = weekFolders([made('2026-10-19'), made('2026-10-12')], [prop('2026-10-22'), prop('2026-10-24')], '2026-10-18');
    expect(rows.map((r) => [r.date, r.state])).toEqual([
      ['2026-10-19', 'opened'], ['2026-10-22', 'upcoming'], ['2026-10-24', 'upcoming'],
    ]);
    expect(rows.map(isLocked)).toEqual([true, false, false]);
  });

  it('a day already opened is never offered again as a proposal', () => {
    const rows = weekFolders([made('2026-10-22')], [prop('2026-10-22')], '2026-10-18');
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe('opened');
  });
});

describe('each kind\'s posts and their own numbers', () => {
  const posts = [
    post({ id: 'm', kind: 'message', likes: 4, delivered: 19 }),
    post({ id: 's', kind: 'survey', answers: 6, delivered: 20 }),
    post({ id: 'ph', kind: 'photos', likes: 23, photos: 6, at: '2026-10-19T09:00:00Z' }),
    post({ id: 'ph2', kind: 'photos', likes: 41, photos: 6, at: '2026-10-20T09:00:00Z' }),
  ];

  it('never mixes kinds, newest first', () => {
    expect(postsOf(posts, 'photos').map((p) => p.id)).toEqual(['ph2', 'ph']);
    expect(postsOf(posts, 'surveys').map((p) => p.id)).toEqual(['s']);
    expect(postsOf(posts, 'cheers')).toEqual([]);
  });

  it('a message: likes and the phones it reached, out of the club', () => {
    expect(resultChips(posts[0], 20)).toEqual([{ key: 'likes', text: '4' }, { key: 'delivered', text: '19/20' }]);
  });

  it('a survey: answers instead of likes', () => {
    expect(resultChips(posts[1], 20).map((c) => c.key)).toEqual(['answers', 'delivered']);
  });

  it('an unknown delivery count is left out, not shown as 0', () => {
    expect(resultChips(posts[2], 20).map((c) => c.key)).toEqual(['likes', 'photos']);
  });
});

describe('"waiting for you" stays in its own block', () => {
  it('photos: only what the club hasn\'t seen', () => {
    expect(photosWaiting({ date: 'd', name: 'אימון', found: 14, published: 0, previews: [] })?.title).toBe('14 תמונות · אימון');
    expect(photosWaiting({ date: 'd', name: 'אימון', found: 14, published: 6, previews: [] })?.title).toBe('8 תמונות חדשות · אימון');
    expect(photosWaiting({ date: 'd', name: 'אימון', found: 6, published: 6, previews: [] })).toBeNull();
    expect(photosWaiting({ date: 'd', name: 'אימון', found: 0, published: 0, previews: [] })).toBeNull();
    expect(photosWaiting(null)).toBeNull();
  });

  it('surveys: the one closing soonest that still has people to answer', () => {
    const w = surveyWaiting([
      { id: 'late', title: 'מאוחר', until: '2026-10-25', answers: 3 },
      { id: 'soon', title: 'מחר', until: '2026-10-21', answers: 6 },
      { id: 'full', title: 'כולם', until: '2026-10-20', answers: 20 },
    ], 20, '2026-10-20');
    expect(w).toMatchObject({ surveyId: 'soon', sub: 'נסגר מחר · 14 עוד לא ענו' });
  });

  it('cheers: the newest suggestion, and how many more', () => {
    expect(cheerWaiting([])).toBeNull();
    expect(cheerWaiting([
      { athleteId: 'a', name: 'אורי', detail: 'חצי מרתון ב־1:34', line: '' },
      { athleteId: 'b', name: 'דנה', detail: 'שיא', line: '' },
    ])).toMatchObject({ athleteId: 'a', title: 'אורי · חצי מרתון ב־1:34', sub: 'ברכה מוצעת · ועוד 1' });
  });
});

describe('one post\'s results', () => {
  const members = [
    { id: 'a', name: 'נועה', lastSeenAt: '2026-10-20T10:00:00Z' },
    { id: 'b', name: 'אורי', lastSeenAt: '2026-10-19T10:00:00Z' },
    { id: 'c', name: 'רוני', lastSeenAt: null },
  ];

  it('who liked, and who hasn\'t opened the app since it went up', () => {
    const r = shapePostResults({ postedAt: '2026-10-20T08:00:00Z', likerIds: ['a', 'a', 'gone'], comments: 2, delivered: 19, members });
    expect(r.likes).toBe(2);
    expect(r.likers).toEqual([{ id: 'a', name: 'נועה' }]);
    expect(r.notSeen.map((m) => m.id)).toEqual(['c', 'b']);
    expect(r.votes).toBeNull();
    expect(r.members).toBe(3);
  });

  it('a survey: votes per option and the leader', () => {
    const r = shapePostResults({ postedAt: '2026-10-20T08:00:00Z', likerIds: [], comments: 0, delivered: null, members,
      survey: { options: ['טבריה', 'ים המלח', 'אילת'], responses: [0, 0, 1, 0] } });
    expect(r.answered).toBe(4);
    expect(r.votes).toEqual([
      { option: 'טבריה', count: 3, leading: true },
      { option: 'ים המלח', count: 1, leading: false },
      { option: 'אילת', count: 0, leading: false },
    ]);
  });
});
