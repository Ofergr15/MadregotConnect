import { describe, it, expect } from 'vitest';
import { escapeLike, containsPattern, quoteFilterValue } from '@/lib/db/like';

describe('escapeLike', () => {
  it('leaves ordinary text alone', () => {
    expect(escapeLike('Dana Cohen')).toBe('Dana Cohen');
    expect(escapeLike('דנה כהן')).toBe('דנה כהן');
  });

  it('neutralises the LIKE wildcards', () => {
    // `_` matched any single character, so `a_b` also matched `axb`.
    expect(escapeLike('a_b')).toBe('a\\_b');
    // `%` matched anything at all, so a one-character query returned the table.
    expect(escapeLike('50%')).toBe('50\\%');
  });

  it('escapes the escape character itself', () => {
    expect(escapeLike('a\\b')).toBe('a\\\\b');
  });
});

describe('containsPattern', () => {
  it('wraps the escaped value in wildcards', () => {
    expect(containsPattern('cohen')).toBe('%cohen%');
    expect(containsPattern('a_b')).toBe('%a\\_b%');
  });
});

describe('quoteFilterValue', () => {
  it('quotes so a comma stops being a condition delimiter', () => {
    // This is the case that used to 400 the whole search request: PostgREST
    // read `Cohen` and ` Dana` as two separate filter conditions.
    expect(quoteFilterValue('%Cohen, Dana%')).toBe('"%Cohen, Dana%"');
  });

  it('quotes parentheses too', () => {
    expect(quoteFilterValue('%a(b)%')).toBe('"%a(b)%"');
  });

  it('doubles a backslash, because PostgREST unescapes one inside the quotes', () => {
    // `%50\%%` on the wire has to be `"%50\\%%"` so PostgREST hands Postgres a
    // single backslash and Postgres reads it as "a literal percent sign".
    expect(quoteFilterValue(containsPattern('50%'))).toBe('"%50\\\\%%"');
  });

  it('escapes a double quote', () => {
    expect(quoteFilterValue('%say "hi"%')).toBe('"%say \\"hi\\"%"');
  });
});
