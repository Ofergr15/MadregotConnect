import { randomBytes } from 'crypto';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

type SyntheticSessionResult =
  | {
      session: {
        access_token: string;
        refresh_token: string;
        expires_in: number;
        token_type: string;
      };
      user: User;
      error?: never;
    }
  | { session?: never; user?: never; error: string };

/**
 * Establishes a normal Supabase session for a server-verified external identity.
 *
 * Supabase has no "admin create session" API. Admin-generated magic-link hashes
 * proved unreliable in the sandbox (fresh hashes returned otp_expired), so we
 * rotate an unknown random password and immediately exchange it server-side.
 * The password never leaves the server; only standard session tokens are sent
 * in the URL fragment, matching Supabase's implicit auth flow.
 */
export async function createSyntheticSession(
  admin: SupabaseClient,
  email: string,
  metadata: Record<string, unknown> = {},
): Promise<SyntheticSessionResult> {
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: metadata,
  });

  let user = created.data.user;
  if (created.error && !/already|registered|exists/i.test(created.error.message)) {
    return { error: `create_user:${created.error.message}` };
  }

  if (!user) {
    // Small single-club app; walk pages only until the synthetic email is found.
    for (let page = 1; page <= 10 && !user; page++) {
      const listed = await admin.auth.admin.listUsers({ page, perPage: 100 });
      if (listed.error) return { error: `list_users:${listed.error.message}` };
      user =
        listed.data.users.find((candidate) => candidate.email?.toLowerCase() === email) || null;
      if (listed.data.users.length < 100) break;
    }
  }

  if (!user) return { error: 'auth_user_not_found' };

  const password = randomBytes(32).toString('base64url');
  const updated = await admin.auth.admin.updateUserById(user.id, {
    password,
    email_confirm: true,
    user_metadata: { ...user.user_metadata, ...metadata },
  });
  if (updated.error) return { error: `update_password:${updated.error.message}` };

  const authClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const signedIn = await authClient.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session || !signedIn.data.user) {
    return { error: `password_sign_in:${signedIn.error?.message || 'missing_session'}` };
  }

  return {
    session: {
      access_token: signedIn.data.session.access_token,
      refresh_token: signedIn.data.session.refresh_token,
      expires_in: signedIn.data.session.expires_in,
      token_type: signedIn.data.session.token_type,
    },
    user: signedIn.data.user,
  };
}
