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
