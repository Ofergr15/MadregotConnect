import { afterEach, describe, expect, it, vi } from 'vitest';
import { devSurfaceBlocks } from '@/lib/email/send';
import { isDevApiRequestAllowed, DEV_SUPABASE_REF } from '@/lib/dev-api-allowlist';

const DEV = { VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'u21-personal-coach' };
const QA = 'qa+import24@example.test';

describe('dev surface mail: deny by default, only MC_DEV_MAIL_ALLOW', () => {
  it('no allow list → every address blocked (fail closed)', () => {
    expect(devSurfaceBlocks(QA, DEV)).toBe(true);
    expect(devSurfaceBlocks('someone@example.test', DEV)).toBe(true);
  });
  it('only the exact listed identity passes (case-insensitive)', () => {
    const env = { ...DEV, MC_DEV_MAIL_ALLOW: QA.toUpperCase() };
    expect(devSurfaceBlocks(QA, env)).toBe(false);
    expect(devSurfaceBlocks('qa+import25@example.test', env)).toBe(true);
  });
  it('production, other previews and local dev are unaffected', () => {
    expect(devSurfaceBlocks(QA, { VERCEL: '1', VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'u21-personal-coach' })).toBe(false);
    expect(devSurfaceBlocks(QA, { VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'other', NEXT_PUBLIC_SUPABASE_URL: 'https://otherprojectref1234.supabase.co' })).toBe(false);
    expect(devSurfaceBlocks(QA, {})).toBe(false);
  });
});

describe('allowlist on the dev Supabase project', () => {
  const ON = { MC_DEV_API_ALLOWLIST: '1' };
  it('dev ref + flag → open', () => {
    expect(isDevApiRequestAllowed('GET', '/api/feed', { ...ON, NEXT_PUBLIC_SUPABASE_URL: `https://${DEV_SUPABASE_REF}.supabase.co` })).toBe(true);
  });

});

describe('dev surface push: suppressed for everyone', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  it('web push and APNs send nothing on the dev surface', async () => {
    for (const [k, v] of Object.entries(DEV)) vi.stubEnv(k, v);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sendPushDetailed } = await import('@/lib/push');
    expect(await sendPushDetailed([{ id: 's', athlete_id: 'a', endpoint: 'https://x', p256dh: 'k', auth: 'a' } as never], { title: 't', body: 'b' })).toEqual({ sent: 0, byAthlete: {} });
  });
});
