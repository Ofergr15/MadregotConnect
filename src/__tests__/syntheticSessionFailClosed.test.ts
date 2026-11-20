import { beforeEach, describe, expect, it, vi } from 'vitest';

/** createSyntheticSession never rotates a password: a magic-link failure fails the sign-in instead. */
let verify: () => Promise<unknown>;
const signInWithPassword = vi.fn();
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { verifyOtp: () => verify(), signInWithPassword } }) }));
const { createSyntheticSession } = await import('@/lib/auth/synthetic-session');

const user = { id: 'u1', email: 'qa@example.com', user_metadata: {} };
const mkAdmin = (link: unknown) => {
  const updateUserById = vi.fn(async () => ({ data: { user }, error: null }));
  return {
    updateUserById,
    admin: { auth: { admin: { createUser: async () => ({ data: { user }, error: null }), updateUserById, generateLink: async () => link, listUsers: vi.fn() } } } as never,
  };
};

beforeEach(() => { signInWithPassword.mockReset(); vi.spyOn(console, 'warn').mockImplementation(() => {}); });

describe('createSyntheticSession fails closed', () => {
  it('good path: magic link → standard session, no password touched', async () => {
    verify = async () => ({ data: { session: { access_token: 'a', refresh_token: 'r', expires_in: 3600, token_type: 'bearer' }, user }, error: null });
    const { admin, updateUserById } = mkAdmin({ data: { properties: { hashed_token: 'h' } }, error: null });
    const r = await createSyntheticSession(admin, 'qa@example.com');
    expect(r.session).toMatchObject({ access_token: 'a', refresh_token: 'r' });
    expect(updateUserById).not.toHaveBeenCalled();
  });
  it('generateLink fails → error, NO password rotation, NO password sign-in', async () => {
    const { admin, updateUserById } = mkAdmin({ data: null, error: { message: 'down' } });
    const r = await createSyntheticSession(admin, 'qa@example.com');
    expect(r.error).toBe('generate_link:down');
    expect(updateUserById).not.toHaveBeenCalled();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });
  it('magic link redeems to no session → error, still no password mutation', async () => {
    verify = async () => ({ data: { session: null, user: null }, error: { message: 'otp_expired' } });
    const { admin, updateUserById } = mkAdmin({ data: { properties: { hashed_token: 'h' } }, error: null });
    const r = await createSyntheticSession(admin, 'qa@example.com');
    expect(r.error).toBe('magic_link_verify:otp_expired');
    expect(updateUserById).not.toHaveBeenCalled();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });
});
