import { describe, expect, it } from 'vitest';
import { audienceTargets, cheerText, closesAt, parseRecordUrl, plainText, readAudience, splitMessage } from '@/lib/publish/model';
import { parseMentions } from '@/lib/feed/mentions';

const A = '11111111-1111-1111-1111-111111111111';
const G1 = '22222222-2222-2222-2222-222222222222';
const G2 = '33333333-3333-3333-3333-333333333333';

describe('who a message goes to', () => {
  it('everyone is one row; each pack or person its own', () => {
    expect(audienceTargets({ mode: 'all', groupIds: [G1], athleteIds: [] })).toEqual([{ audience_type: 'all', audience_id: null }]);
    expect(audienceTargets({ mode: 'groups', groupIds: [G1, G2, G1], athleteIds: [] })).toEqual([
      { audience_type: 'group', audience_id: G1 }, { audience_type: 'group', audience_id: G2 }]);
    expect(audienceTargets({ mode: 'people', groupIds: [], athleteIds: [A] })).toEqual([{ audience_type: 'athlete', audience_id: A }]);
  });
  it('a body without anyone in a chosen mode is not a choice', () => {
    expect(readAudience({ mode: 'groups', groupIds: [] })).toBeNull();
    expect(readAudience({ mode: 'people', athleteIds: ['not-an-id'] })).toBeNull();
    expect(readAudience({ mode: 'nobody' })).toBeNull();
    expect(readAudience(undefined)).toEqual({ mode: 'all', groupIds: [], athleteIds: [] });
  });
});

describe('the message', () => {
  it('first line is the title; one line is the body under the club name', () => {
    expect(splitMessage('אימון מחר\nב־19:00 בגשר')).toEqual({ title: 'אימון מחר', body: 'ב־19:00 בגשר' });
    expect(splitMessage('אימון מחר ב־19:00')).toEqual({ title: 'מדרגות', body: 'אימון מחר ב־19:00' });
  });
  it('a tag shows as a plain name on the lock screen', () => {
    expect(plainText(`כל הכבוד @[Roy Roth](${A})!`)).toBe('כל הכבוד Roy Roth!');
  });
});

describe('the cheer', () => {
  it('tags the person, says what for', () => {
    const t = cheerText('Roy Roth', A, 'race', 'מרתון תל אביב ב־2:58:41');
    expect(t).toBe(`כל הכבוד @[Roy Roth](${A}) על מרתון תל אביב ב־2:58:41! 🏁`);
    expect(parseMentions(t)[0]).toMatchObject({ athleteId: A });
    expect(cheerText('Roy Roth', A, 'record')).toBe(`כל הכבוד @[Roy Roth](${A}) על שיא אישי חדש! 🏅`);
  });
  it('reads a record push back into who, which distance, which run', () => {
    expect(parseRecordUrl(`/dashboard/teammate/${A}/records/10k?new=${G1}`)).toEqual({ athleteId: A, bucket: '10k', activityId: G1 });
    expect(parseRecordUrl('/feed')).toBeNull();
  });
});

describe('when a survey closes', () => {
  it('23:59 Israel time tomorrow or in a week; never is null', () => {
    const now = new Date('2026-10-18T14:00:00Z'); // summer time, +03:00
    expect(closesAt('tomorrow', now)).toBe('2026-10-19T20:59:00.000Z');
    expect(closesAt('week', now)).toBe('2026-10-25T21:59:00.000Z'); // winter time from 25.10, +02:00
    expect(closesAt('none', now)).toBeNull();
  });
});
