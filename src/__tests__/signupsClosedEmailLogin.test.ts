import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// 2026-11-25, before the Frankfurt move: the PWA landing is ONE path (email → 6-digit code),
// and new sign-ups are closed behind the club-wide `signups_open` switch (default off).

const read = (f: string) => readFileSync(path.join(__dirname, '..', f), 'utf8');

const rows = { value: [] as unknown[] | null, failed: false };
vi.mock('@/lib/features/server', () => ({
  readEnablementRows: async () => ({ rows: rows.value, failed: rows.failed }),
}));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }));

const { FEATURES, PUBLIC_FEATURE_KEYS, CLUB_SCOPE_ID } = await import('@/lib/features/flags');
const { signupsOpen } = await import('@/lib/signups/open');
const { placeDigits, codeDigits } = await import('@/lib/auth/code-input');

const clubRow = (enabled: boolean) => ({ feature: 'signups_open', scope_type: 'club', scope_id: CLUB_SCOPE_ID, enabled, set_by: null, set_at: null });

beforeEach(() => { rows.value = []; rows.failed = false; });

describe('signups_open — the club switch', () => {
  it('is a feature, default OFF, readable signed out', () => {
    expect(FEATURES.signups_open.defaultEnabled).toBe(false);
    expect(PUBLIC_FEATURE_KEYS).toContain('signups_open');
  });
  it('is closed with no rows, a missing table, or a failed read', async () => {
    expect(await signupsOpen()).toBe(false);
    rows.value = null;
    expect(await signupsOpen()).toBe(false);
    rows.value = [clubRow(true)]; rows.failed = true;
    expect(await signupsOpen()).toBe(false);
  });
  it('opens only on a club row, without a deploy', async () => {
    rows.value = [clubRow(true)];
    expect(await signupsOpen()).toBe(true);
    rows.value = [clubRow(false)];
    expect(await signupsOpen()).toBe(false);
  });
});

describe('closed sign-up doors', () => {
  it('POST /api/public/signup refuses first, the same for every address', async () => {
    const { POST } = await import('@/app/api/public/signup/route');
    const res = await POST(new Request('http://x/api/public/signup', { method: 'POST', body: JSON.stringify({ email: 'a@b.co' }) }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'signups-closed' });
  });
  it('/register shows the closed note instead of the form', () => {
    const layout = read('app/register/layout.tsx');
    expect(layout).toMatch(/\(await signupsOpen\(\)\) \? children : <SignupsClosed \/>/);
    expect(read('components/auth/SignupsClosed.tsx')).toContain('ההרשמה סגורה כרגע');
  });
  it('the academy public door needs the club switch too; a personal invite still gets through', () => {
    const reg = read('lib/academy/registration.ts');
    expect(reg).toMatch(/return academy && club;/);
    expect(reg).toMatch(/if \(await isPublicDoorOpen\(supabase\)\) return true;\s+return isLiveInvite/);
  });
  it('invite links (/join/{token}) never consult the switch', () => {
    expect(read('app/join/[token]/page.tsx')).not.toMatch(/signups_open|signupsOpen/);
  });
});

describe('the email-only landing page', () => {
  const page = read('app/page.tsx');
  const form = read('components/auth/EmailCodeLogin.tsx');
  it('offers no Strava, Google or password on the main path', () => {
    for (const src of [page, form]) {
      expect(src).not.toMatch(/strava\?mode=login|signInWithStrava|type="password"|signInWithOAuth|provider: 'google'/);
    }
    expect(page).toMatch(/<EmailCodeLogin \/>/);
  });
  it('shows the join link only when signups_open is on', () => {
    expect(page).toMatch(/\{signupsOpen && \(/);
    expect(page).toMatch(/features\?\.signups_open === true/);
  });
  it('says the same thing to every address (no membership oracle)', () => {
    expect(form).toContain('רשומה אצלנו, שלחנו אליה קוד');
  });
});

describe('6-box code entry', () => {
  const empty = () => Array(6).fill('');
  it('advances one box per typed digit', () => {
    const { next, focus } = placeDigits(empty(), 0, '4');
    expect(next[0]).toBe('4');
    expect(focus).toBe(1);
  });
  it('a pasted code fills every box from the first, whatever box it landed in', () => {
    const { next, focus } = placeDigits(empty(), 3, '12 34-56');
    expect(next).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(focus).toBe(6);
    expect(codeDigits(next)).toBe('123456');
  });
  it('typing over a filled box keeps only the new digit', () => {
    const cur = ['1', '', '', '', '', ''];
    expect(placeDigits(cur, 0, '17').next[0]).toBe('7');
  });
  it('clearing a box empties it; an incomplete code is not submitted', () => {
    const { next } = placeDigits(['1', '2', '', '', '', ''], 1, '');
    expect(next[1]).toBe('');
    expect(codeDigits(next)).toBeNull();
  });
});
