import { describe, expect, it } from 'vitest';
import { outboundAllowed } from '@/lib/outbound-policy';

describe('outboundAllowed (proposal, not wired)', () => {
  it('production: always allowed, flags ignored', () => {
    expect(outboundAllowed('email', 'real@x.com', { VERCEL_ENV: 'production', MC_OUTBOUND: 'none' })).toEqual({ allowed: true });
  });
  it('local / preview with nothing set: denied', () => {
    expect(outboundAllowed('email', 'real@x.com', {})).toMatchObject({ allowed: false });
    expect(outboundAllowed('webpush', null, { VERCEL: '1', VERCEL_ENV: 'preview' })).toMatchObject({ allowed: false });
  });
  it('allowlist mode: only listed addresses, case-insensitive', () => {
    const env = { MC_OUTBOUND: 'allowlist', MC_OUTBOUND_ALLOW: 'QA+import24@example.com, other@example.com' };
    expect(outboundAllowed('email', 'qa+import24@example.com', env)).toEqual({ allowed: true });
    expect(outboundAllowed('email', 'approver@example.com', env)).toMatchObject({ allowed: false, reason: 'outbound:not-allowlisted' });
    expect(outboundAllowed('staff', null, env)).toMatchObject({ allowed: false });
  });
  it('a typo is deny, never allow', () => {
    for (const m of ['ALL', 'true', '1', 'yes']) expect(outboundAllowed('email', 'a@x.com', { MC_OUTBOUND: m })).toMatchObject({ allowed: false });
  });
  it('explicit all is the only non-production opt-out', () => {
    expect(outboundAllowed('apns', 'a@x.com', { MC_OUTBOUND: 'all' })).toEqual({ allowed: true });
  });
});
