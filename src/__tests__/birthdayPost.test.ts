import { describe, expect, it } from 'vitest';
import { birthdayBody } from '@/lib/feed/birthday';
import { parseMentions } from '@/lib/feed/mentions';

describe('the birthday post', () => {
  it('tags the birthday person, so the card links them', () => {
    const body = birthdayBody('Shalev Mizrahi', '11111111-1111-1111-1111-111111111111');
    expect(body.startsWith('🎂 היום יום ההולדת של ')).toBe(true);
    expect(parseMentions(body)).toEqual([expect.objectContaining({ name: 'Shalev Mizrahi', athleteId: '11111111-1111-1111-1111-111111111111' })]);
  });
});

describe('the birthday wording as days pass', () => {
  it('says today on the day, yesterday the day after, the weekday later, and leaves other text alone', async () => {
    const { birthdayBodyAsOf } = await import('@/lib/feed/birthday');
    const body = '🎂 היום יום ההולדת של @[Shalev Bahalul](ed97be1c-ba4f-44d5-a03e-f9494d9cd257)! מזל טוב 🎉';
    expect(birthdayBodyAsOf(body, '2026-10-18', '2026-10-18')).toBe(body);
    expect(birthdayBodyAsOf(body, '2026-10-18', '2026-10-19')).toBe('🎂 אתמול היה יום ההולדת של @[Shalev Bahalul](ed97be1c-ba4f-44d5-a03e-f9494d9cd257)! מזל טוב 🎉');
    expect(birthdayBodyAsOf(body, '2026-10-18', '2026-10-21')).toContain('ביום ראשון היה יום ההולדת');
    expect(birthdayBodyAsOf('מזל טוב שלו!', '2026-10-18', '2026-10-20')).toBe('מזל טוב שלו!');
  });
});
