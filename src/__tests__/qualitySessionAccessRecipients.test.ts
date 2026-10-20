import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { qsAccessFrom } from '@/lib/quality-session/use-access';
import { qualitySessionRecipientIds } from '@/lib/quality-session/access';

// Ofer, 2026-10-20: the 7:30 push opened a page that stayed empty (a view-as preview
// rendered nothing), and it never reached the club's admin account.

type Row = { id: string; is_super_user?: boolean; email?: string; is_story_editor?: boolean; role?: string };
function fakeDb(rows: Row[]) {
  return {
    from: () => ({
      select: () => ({
        eq: (col: keyof Row, val: unknown) => Promise.resolve({ data: rows.filter(r => r[col] === val).map(r => ({ id: r.id })), error: null }),
      }),
    }),
  } as never;
}

describe('quality session access state', () => {
  it('is yes for a super user before /api/auth/me answers', () => {
    expect(qsAccessFrom(true, undefined, false)).toBe('yes');
  });
  it('is unknown while /api/auth/me is still on its way, so the screen says loading', () => {
    expect(qsAccessFrom(false, undefined, false)).toBe('unknown');
  });
  it('follows the server flag once it answers', () => {
    expect(qsAccessFrom(false, { qualitySession: true }, false)).toBe('yes');
    expect(qsAccessFrom(false, { qualitySession: false }, false)).toBe('no');
    expect(qsAccessFrom(false, undefined, true)).toBe('no');
  });
});

describe('quality session recipients', () => {
  it('are the super users (the admin account included), the super user address and the story editors, once each', async () => {
    const db = fakeDb([
      { id: 'admin', is_super_user: true, role: 'admin' },
      { id: 'ofer', is_super_user: true, email: 'me@x', is_story_editor: true },
      { id: 'guy', is_story_editor: true },
      { id: 'runner' },
    ]);
    const ids = await qualitySessionRecipientIds(db, 'me@x');
    expect(ids.sort()).toEqual(['admin', 'guy', 'ofer']);
  });
});

describe('the quality session screen', () => {
  const src = readFileSync('src/app/(app)/dashboard/quality-session/page.tsx', 'utf8');
  it('never renders nothing when the screen is closed to this view', () => {
    expect(src).not.toMatch(/if \(!allowed\) return null/);
    expect(src).toContain('לחזור לתצוגה שלי ולפתוח');
  });
  it('offers a retry when the session fails to load', () => {
    expect(src).toContain('לנסות שוב');
  });
  it('the 7:30 push and the photo folder use the same recipient list', () => {
    expect(readFileSync('src/app/api/cron/tick/route.ts', 'utf8')).toContain('qualitySessionRecipientIds(supabase, SUPER_USER_EMAIL)');
    expect(readFileSync('src/lib/quality-session/photos-server.ts', 'utf8')).toContain('qualitySessionRecipientIds(supabase, SUPER_USER_EMAIL)');
  });
});
