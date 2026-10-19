import { beforeEach, describe, expect, it, vi } from 'vitest';

const caller = vi.fn();
const gate = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({ resolveVerifiedCaller: () => caller() }));
vi.mock('@/lib/stories/gate', () => ({ storyGate: (...a: unknown[]) => gate(...a) }));
const { GET } = await import('@/app/api/stories/weekly/route');
const req = () => GET(new Request('http://x/api/stories/weekly'));
const runner = { denied: null, caller: { athleteId: 'dana', role: 'runner', roles: ['runner'], isSuperUser: false } };

beforeEach(() => { caller.mockResolvedValue(runner); gate.mockReset(); });

describe('GET /api/stories/weekly', () => {
  it('404s a non-tester', async () => {
    gate.mockResolvedValue({ allowed: false });
    const res = await req();
    expect(res.status).toBe(404);
    expect((await res.json()).allowed).toBe(false);
  });
  it('tells a tester she is one', async () => {
    gate.mockResolvedValue({ allowed: true, tester: true, preview: false, state: 'testers' });
    expect(await (await req()).json()).toMatchObject({ allowed: true, tester: true });
  });
  it('asks the gate as a non-admin for a runner', async () => {
    gate.mockResolvedValue({ allowed: false });
    await req();
    expect(gate).toHaveBeenCalledWith('weekly', 'dana', { isAdmin: false });
  });
});
