import { describe, expect, it } from 'vitest';
import { typeClock } from '@/lib/time-entry';

describe('typeClock — a time typed on a number pad with no ":"', () => {
  it('lays the digits out from the right', () => {
    expect(typeClock('2')).toBe('2');
    expect(typeClock('23')).toBe('23');
    expect(typeClock('234')).toBe('2:34');
    expect(typeClock('2340')).toBe('23:40');
    expect(typeClock('23400')).toBe('2:34:00');
    expect(typeClock('241200')).toBe('24:12:00');
  });
  it('ignores typed or pasted colons and spaces', () => {
    expect(typeClock('2:34:00')).toBe('2:34:00');
    expect(typeClock('36:55')).toBe('36:55');
    expect(typeClock(' 1:18:40 ')).toBe('1:18:40');
  });
  it('drops leading zeros that would make an extra field, and caps the length', () => {
    expect(typeClock('023400')).toBe('2:34:00');
    expect(typeClock('0730')).toBe('7:30');
    expect(typeClock('1234567')).toBe('12:34:56');
    expect(typeClock('44530', 4)).toBe('44:53');
  });
});
