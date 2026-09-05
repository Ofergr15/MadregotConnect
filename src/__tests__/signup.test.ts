import { describe, it, expect } from 'vitest';
import { isLikelyEmail, normaliseEmail, placeholderNameFromEmail } from '@/lib/signup';

describe('isLikelyEmail', () => {
  it('accepts ordinary addresses', () => {
    for (const ok of ['dana@gmail.com', 'a.b+tag@sub.domain.co.il', 'x_y-z@mail.org']) {
      expect(isLikelyEmail(ok), ok).toBe(true);
    }
  });

  it('rejects the typos a form actually produces', () => {
    for (const bad of ['', ' ', 'dana', 'dana@', '@gmail.com', 'dana@gmail', 'dana gmail.com', 'a@b.c']) {
      expect(isLikelyEmail(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('tolerates surrounding whitespace, which a paste from WhatsApp carries', () => {
    expect(isLikelyEmail('  dana@gmail.com  ')).toBe(true);
  });

  it('is null-safe — the body field is optional', () => {
    expect(isLikelyEmail(null)).toBe(false);
    expect(isLikelyEmail(undefined)).toBe(false);
  });
});

describe('normaliseEmail', () => {
  // The pending-email unique index does NOT lower(), so the API must.
  it('lowercases and trims, so the unique index holds', () => {
    expect(normaliseEmail('  Dana.Levi@Gmail.COM ')).toBe('dana.levi@gmail.com');
  });
});

describe('placeholderNameFromEmail', () => {
  it('reads a name out of the local part', () => {
    expect(placeholderNameFromEmail('dana.levi@gmail.com')).toBe('Dana Levi');
    expect(placeholderNameFromEmail('amit_lazar@gmail.com')).toBe('Amit Lazar');
    expect(placeholderNameFromEmail('yair-gb@gmail.com')).toBe('Yair Gb');
  });

  it('drops digits — "dana.levi92" is a person called Dana Levi', () => {
    expect(placeholderNameFromEmail('dana.levi92@gmail.com')).toBe('Dana Levi');
    expect(placeholderNameFromEmail('runner2026@gmail.com')).toBe('Runner');
  });

  it('handles a single word and a plus-tag', () => {
    expect(placeholderNameFromEmail('ofer@gmail.com')).toBe('Ofer');
    expect(placeholderNameFromEmail('ofer+club@gmail.com')).toBe('Ofer Club');
  });

  it('normalises before splitting, so case in the address does not leak through', () => {
    expect(placeholderNameFromEmail('DANA.LEVI@GMAIL.COM')).toBe('Dana Levi');
  });

  // athletes.name is NOT NULL, so the one thing this must never return is ''.
  it('never returns empty, however unname-like the address', () => {
    expect(placeholderNameFromEmail('42@x.co')).toBe('42@x.co');
    expect(placeholderNameFromEmail('___@x.co')).toBe('___@x.co');
    expect(placeholderNameFromEmail('@x.co')).toBe('@x.co');
  });
});
