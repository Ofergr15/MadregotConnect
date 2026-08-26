import { describe, expect, it } from 'vitest';
import { parseMentions, renderMentionSegments, uniqueMentionedAthleteIds, mentionToken } from '@/lib/feed/mentions';

const ALICE = '11111111-1111-1111-1111-111111111111';
const BOB = '22222222-2222-2222-2222-222222222222';

describe('mentionToken', () => {
  it('builds the exact embeddable token', () => {
    expect(mentionToken('Alice', ALICE)).toBe(`@[Alice](${ALICE})`);
  });
});

describe('parseMentions', () => {
  it('extracts a single mention', () => {
    expect(parseMentions(`Great run with @[Alice](${ALICE}) today!`)).toEqual([
      { name: 'Alice', athleteId: ALICE, raw: `@[Alice](${ALICE})` },
    ]);
  });

  it('extracts multiple mentions in order', () => {
    const body = `@[Alice](${ALICE}) and @[Bob](${BOB}) crushed it`;
    expect(parseMentions(body).map((m) => m.name)).toEqual(['Alice', 'Bob']);
  });

  it('returns an empty array for a body with no mentions', () => {
    expect(parseMentions('Just a normal post')).toEqual([]);
  });

  it('ignores a plain "@name" with no bracket/id — not a real mention token', () => {
    expect(parseMentions('Thanks @Alice for the tip')).toEqual([]);
  });

  it('ignores a malformed token whose id is not a real UUID shape', () => {
    expect(parseMentions('@[Alice](not-a-uuid)')).toEqual([]);
  });

  it('handles a name containing spaces and punctuation', () => {
    expect(parseMentions(`@[Tal-Boren Jr.](${ALICE})`)[0].name).toBe('Tal-Boren Jr.');
  });
});

describe('renderMentionSegments', () => {
  it('splits text-mention-text correctly', () => {
    const body = `Hey @[Alice](${ALICE}), nice run!`;
    expect(renderMentionSegments(body)).toEqual([
      { type: 'text', content: 'Hey ' },
      { type: 'mention', name: 'Alice', athleteId: ALICE },
      { type: 'text', content: ', nice run!' },
    ]);
  });

  it('a body that is ONLY a mention produces no empty text segments', () => {
    const body = `@[Alice](${ALICE})`;
    expect(renderMentionSegments(body)).toEqual([{ type: 'mention', name: 'Alice', athleteId: ALICE }]);
  });

  it('a plain body with no mentions is a single text segment', () => {
    expect(renderMentionSegments('just text')).toEqual([{ type: 'text', content: 'just text' }]);
  });

  it('two back-to-back mentions produce no empty text segment between them', () => {
    const body = `@[Alice](${ALICE})@[Bob](${BOB})`;
    expect(renderMentionSegments(body)).toEqual([
      { type: 'mention', name: 'Alice', athleteId: ALICE },
      { type: 'mention', name: 'Bob', athleteId: BOB },
    ]);
  });

  it('an empty body returns an empty array, not a stray empty text segment', () => {
    expect(renderMentionSegments('')).toEqual([]);
  });
});

describe('uniqueMentionedAthleteIds', () => {
  it('returns mentioned ids excluding the author', () => {
    const body = `@[Alice](${ALICE}) @[Bob](${BOB})`;
    expect(uniqueMentionedAthleteIds(body, 'author-id').sort()).toEqual([ALICE, BOB].sort());
  });

  it('excludes a self-mention — tagging yourself never notifies you', () => {
    const body = `@[Alice](${ALICE})`;
    expect(uniqueMentionedAthleteIds(body, ALICE)).toEqual([]);
  });

  it('mentioning the same athlete twice only notifies them once', () => {
    const body = `@[Alice](${ALICE}) thanks @[Alice](${ALICE})!`;
    expect(uniqueMentionedAthleteIds(body, 'author-id')).toEqual([ALICE]);
  });

  it('returns an empty array for a body with no mentions', () => {
    expect(uniqueMentionedAthleteIds('no mentions here', 'author-id')).toEqual([]);
  });
});
