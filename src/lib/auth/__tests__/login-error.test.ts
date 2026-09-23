import { describe, expect, it } from 'vitest';
import { callbackQueryShape, loginErrorText } from '@/lib/auth/login-error';

const REASONS = [
  'denied', 'missing_params', 'not_configured', 'no_athlete', 'lookup_failed', 'save_failed',
  'session_create_failed', 'session_failed', 'session_exception',
];
const FALLBACK = loginErrorText('unknown', null).text;

describe('loginErrorText (#83)', () => {
  it('gives every reason the server sends its own words', () => {
    for (const r of REASONS) expect(loginErrorText(r, null).text).not.toBe(FALLBACK);
  });
  it('falls back for a reason it does not know', () => {
    expect(loginErrorText(null, null).text).toBe(FALLBACK);
    expect(loginErrorText('something_new', null).text).toBe(FALLBACK);
  });
  it('keeps the debug id for a failure, drops it for a cancel', () => {
    expect(loginErrorText('save_failed', 'ab12cd34').debug).toBe('ab12cd34');
    expect(loginErrorText('denied', 'ab12cd34').debug).toBeNull();
  });
  it('does not echo an arbitrary debug value into the page', () => {
    expect(loginErrorText('unknown', '<script>').debug).toBeNull();
  });
});

describe('callbackQueryShape', () => {
  it('logs names and Strava error only, never the code or the state', () => {
    const shape = callbackQueryShape(new URLSearchParams('state=join:abc&error=access_denied&code=secret'));
    expect(shape).toEqual({ keys: ['code', 'error', 'state'], error: 'access_denied' });
    expect(JSON.stringify(shape)).not.toContain('secret');
    expect(JSON.stringify(shape)).not.toContain('abc');
  });
  it('reports an empty hit as empty', () => {
    expect(callbackQueryShape(new URLSearchParams(''))).toEqual({ keys: [], error: null });
  });
});
