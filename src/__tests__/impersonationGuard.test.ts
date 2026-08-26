import { describe, expect, it } from 'vitest';
import { isAllowedWhilePreviewing } from '@/lib/impersonation';

// Regression coverage for the actual root cause of a multi-hour real-device
// debugging session: a stale `view_as_role` left in localStorage made every
// write silently fail (installViewGuard's synthetic 403), invisible to
// server logs since the request never left the client. This exact decision
// function is what needs to keep matching "read-only preview" to "GET-only,
// plus a couple of explicitly allowed paths" — anything looser here quietly
// reintroduces the same multi-hour mystery.

describe('isAllowedWhilePreviewing', () => {
  it('allows GET regardless of URL', () => {
    expect(isAllowedWhilePreviewing('/api/athletes/notification-prefs', 'GET')).toBe(true);
  });

  it('allows HEAD and OPTIONS regardless of URL', () => {
    expect(isAllowedWhilePreviewing('/api/athletes/notification-prefs', 'HEAD')).toBe(true);
    expect(isAllowedWhilePreviewing('/api/athletes/notification-prefs', 'OPTIONS')).toBe(true);
  });

  it('expects an already-uppercased method — the caller (installViewGuard) normalizes case before calling, not this function', () => {
    expect(isAllowedWhilePreviewing('/api/athletes/notification-prefs', 'GET')).toBe(true);
    // A lowercase 'get' is NOT recognized here — that's intentional: this
    // function documents/tests the exact contract its one real caller
    // upholds (uppercase in), rather than silently accepting both and
    // masking a future caller that forgets to normalize.
    expect(isAllowedWhilePreviewing('/api/athletes/notification-prefs', 'get')).toBe(false);
  });

  it('blocks a PUT to a plain data-mutating endpoint — the exact case that broke tonight', () => {
    expect(isAllowedWhilePreviewing('/api/athletes/notification-prefs', 'PUT')).toBe(false);
  });

  it('blocks POST/DELETE to arbitrary endpoints', () => {
    expect(isAllowedWhilePreviewing('/api/athletes/me', 'POST')).toBe(false);
    expect(isAllowedWhilePreviewing('/api/athletes/me', 'DELETE')).toBe(false);
  });

  it('allows Supabase auth/session refresh calls even for mutating methods', () => {
    expect(isAllowedWhilePreviewing('https://x.supabase.co/auth/v1/token?grant_type=refresh_token', 'POST')).toBe(true);
  });

  it('allows sending a real notification/survey — that flow already gates on its own explicit confirm step', () => {
    expect(isAllowedWhilePreviewing('/api/notifications', 'POST')).toBe(true);
    expect(isAllowedWhilePreviewing('/api/admin/surveys', 'POST')).toBe(true);
  });

  it('does NOT allow-list by substring accident — a URL merely containing "notifications" elsewhere is still blocked unless it matches the real allowed path', () => {
    // Guards against a future edit loosening isAllowedWhilePreviewing's
    // substring check in a way that accidentally widens the allowlist.
    expect(isAllowedWhilePreviewing('/api/athletes/notification-prefs', 'PUT')).toBe(false);
  });

  it('is case-insensitive on the URL match (checked lowercase)', () => {
    expect(isAllowedWhilePreviewing('/API/NOTIFICATIONS', 'POST')).toBe(true);
  });
});
