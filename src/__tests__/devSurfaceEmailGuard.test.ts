import { describe, expect, it } from 'vitest';
import { devSurfaceBlocks } from '@/lib/email/send';
import { APPROVER_EMAILS, } from '@/lib/constants';

const DEV = { VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'u21-personal-coach' };
describe('devSurfaceBlocks: the dev preview never mails the fixed staff inboxes', () => {
  it('blocks every APPROVER_EMAILS address and the ADMIN_EMAIL fallback on the dev surface', () => {
    for (const a of APPROVER_EMAILS) expect(devSurfaceBlocks(a.toUpperCase(), DEV), 'approver').toBe(true);
    expect(devSurfaceBlocks('madregot.club@gmail.com', DEV)).toBe(true);
    expect(devSurfaceBlocks('admin@x.example', { ...DEV, ADMIN_EMAIL: 'admin@x.example' })).toBe(true);
  });
  it('lets synthetic dev members through (login code to the QA address)', () => {
    expect(devSurfaceBlocks('qa+import24@example.com', DEV)).toBe(false);
  });
  it('production, other previews and local dev are unaffected', () => {
    const a = APPROVER_EMAILS[0];
    expect(devSurfaceBlocks(a, { VERCEL: '1', VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'u21-personal-coach' })).toBe(false);
    expect(devSurfaceBlocks(a, { VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'other' })).toBe(false);
    expect(devSurfaceBlocks(a, {})).toBe(false);
  });
  it('MC_OUTBOUND=all lifts it deliberately', () => {
    expect(devSurfaceBlocks(APPROVER_EMAILS[0], { ...DEV, MC_OUTBOUND: 'all' })).toBe(false);
  });
});
