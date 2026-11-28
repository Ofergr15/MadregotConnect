// Task 83: push url → native target, one source (PUSH_TARGETS), consumed by the push builder.
import { describe, it, expect, vi } from 'vitest';
import { NATIVE_TARGET_KINDS, PUSH_TARGETS, nativeRoutingMap, toNativeTarget } from '@/lib/notifications/push-targets';
import { buildPushPayload } from '@/lib/notifications/payload';

const requireMember = vi.fn(async () => null as Response | null);
vi.mock('@/lib/auth/self-or-staff', () => ({ requireMember: () => requireMember() }));
const { GET } = await import('@/app/api/push/targets/route');

describe('native routing map', () => {
  it('every target has a known kind, and every kind is used exactly once', () => {
    for (const t of PUSH_TARGETS) expect(NATIVE_TARGET_KINDS).toContain(t.kind);
    expect(PUSH_TARGETS.map((t) => t.kind).sort()).toEqual([...NATIVE_TARGET_KINDS].sort());
  });
  it('resolves params and query, decoded', () => {
    expect(toNativeTarget('/dashboard/teammate/a%20b/records/10k')).toEqual({ kind: 'recordHistory', params: { id: 'a b', bucket: '10k' }, query: {} });
    expect(toNativeTarget('/feed?item=f-1&x=2')).toEqual({ kind: 'feed', params: {}, query: { item: 'f-1', x: '2' } });
    expect(toNativeTarget('/me/pain/p1/checkin')).toMatchObject({ kind: 'painCheckin', params: { id: 'p1' } });
    expect(toNativeTarget('/dashboard/')).toMatchObject({ kind: 'home' });
  });
  it('unknown urls and ledger rows → null; a bad escape does not throw', () => {
    expect(toNativeTarget('/nope')).toBeNull();
    expect(toNativeTarget('#ledger:abc')).toBeNull();
    expect(toNativeTarget('https://evil.example/feed')).toBeNull();
    expect(toNativeTarget('/dashboard/teammate/%E0%A4%A')).toMatchObject({ kind: 'teammate', params: { id: '%E0%A4%A' } });
  });
  it('the push builder attaches the native target for its url', () => {
    const p = buildPushPayload('kudos', 'he', { feedItemId: 'f 9', name: 'דנה' });
    expect(p.target).toEqual({ kind: 'feed', params: {}, query: { item: 'f 9' } });
    const e = buildPushPayload('event_new', 'en', { eventId: 'e1', kind: 'race', name: 'X', date: '2026-12-06' });
    expect(e.target).toMatchObject({ kind: 'event', params: { id: 'e1' } });
  });
  it('docs/push-targets.md lists every kind', async () => {
    const { readFileSync } = await import('node:fs');
    const doc = readFileSync('docs/push-targets.md', 'utf8');
    for (const t of nativeRoutingMap()) expect(doc).toContain(`\`${t.kind}\``);
  });
});

describe('GET /api/push/targets', () => {
  it('member-gated', async () => {
    requireMember.mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect((await GET(new Request('http://x/api/push/targets'))).status).toBe(401);
  });
  it('returns the map', async () => {
    const body = await (await GET(new Request('http://x/api/push/targets'))).json();
    expect(body.kinds).toEqual([...NATIVE_TARGET_KINDS]);
    expect(body.targets).toHaveLength(PUSH_TARGETS.length);
    expect(body.ledgerPrefix).toBe('#ledger:');
  });
});
