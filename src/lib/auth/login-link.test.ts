import { describe, it, expect } from 'vitest';
import { loginRedirectTarget, consumeSigninFlag } from './login-link';

describe('login link', () => {
  it('forwards /login to the landing with the sheet flag', () => {
    expect(loginRedirectTarget('')).toBe('/?signin=1');
  });
  it('preserves query params', () => {
    expect(loginRedirectTarget('?next=%2Ffeed&utm=wa')).toBe('/?next=%2Ffeed&utm=wa&signin=1');
  });
  it('landing consumes only the flag', () => {
    expect(consumeSigninFlag('?next=%2Ffeed&signin=1')).toEqual({ open: true, rest: '/?next=%2Ffeed' });
    expect(consumeSigninFlag('')).toEqual({ open: false, rest: '/' });
  });
});
