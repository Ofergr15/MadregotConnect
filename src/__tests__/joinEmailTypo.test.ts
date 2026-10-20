import { describe, expect, it } from 'vitest';
import { suggestEmail } from '@/lib/join/email-typo';

describe('suggestEmail — a near-miss domain at sign-up', () => {
  it('fixes the common slips', () => {
    expect(suggestEmail('dana@gmial.com')).toBe('dana@gmail.com');
    expect(suggestEmail('dana@gamil.com')).toBe('dana@gmail.com');
    expect(suggestEmail('dana@gmail.con')).toBe('dana@gmail.com');
    expect(suggestEmail('dana@gmail.co')).toBe('dana@gmail.com');
    expect(suggestEmail('Dana@Hotmial.com')).toBe('dana@hotmail.com');
    expect(suggestEmail('avi@walla.co.l')).toBe('avi@walla.co.il');
  });
  it('leaves good and unknown domains alone', () => {
    expect(suggestEmail('grosfeldofer+club20@gmail.com')).toBeNull();
    expect(suggestEmail('ceo@cyera.io')).toBeNull();
    expect(suggestEmail('a@company-name.co.il')).toBeNull();
    expect(suggestEmail('not an email')).toBeNull();
  });
});
