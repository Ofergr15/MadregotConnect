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
 * Supabase has no "admin create session" API, so this mints one out of an
 * admin-generated magic link, verified server-side. Only standard session tokens
 * are ever sent to the client, matching Supabase's implicit auth flow.
 *
 * ⚠️ WHY NOT THE PASSWORD ROTATION IT USED TO DO — the bug this file caused:
 *
 * This used to `updateUserById({ password })` with a random value and immediately
 * `signInWithPassword`. GoTrue drops a user's OTHER sessions when their password
 * changes, so every mint was a silent logout of that account on every other
 * device. And the logout was invisible and unrecoverable: the other phone still
 * held a well-formed, correctly-signed, unexpired JWT, so `getSession()` returned
 * it and the app kept sending it — while Supabase answered
 * `400 "Auth session missing!"` on every gated route, because the JWT's
 * `session_id` no longer existed. `bearerHeaders()` only self-heals when there is
 * NO session, so nothing re-minted; the user got a dead "try again" button that
 * could only ever repeat the same failing request. Clearing site data was the
 * only way out.
 *
 * It also meant silent re-auth could not be trusted on more than one device:
 * two devices each healing themselves would revoke each other in a loop.
 *
 * Measured against production, 2026-09-05, on a throwaway user:
 *   password rotation -> other device's token: 400 "Auth session missing!"
 *   magic link        -> other device's token: still valid
 *
 * An older comment here claimed admin magic-link hashes were unreliable (fresh
 * ones returning `otp_expired`). That was a sandbox observation; verified working
 * on production. The password path is kept only as a fallback below, so a
 * regression in `generateLink` degrades to the old behaviour rather than locking
 * everyone out — it is the worse branch, not the default.
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

  // Metadata is merged on its own now, NOT as a side effect of setting a
  // password. It carries no session consequences.
  if (Object.keys(metadata).length > 0) {
    const merged = await admin.auth.admin.updateUserById(user.id, {
      email_confirm: true,
      user_metadata: { ...user.user_metadata, ...metadata },
    });
    // Non-fatal: the metadata is a nice-to-have (display name, avatar), and
    // failing the whole login over it would be a worse outcome than a session
    // whose metadata is one refresh stale.
    if (merged.error) console.warn('[auth] metadata merge failed', merged.error.message);
  }

  const authClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // The good path: a magic link the client never sees, redeemed here. Leaves
  // every other device's session intact.
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const hashedToken = link.data?.properties?.hashed_token;
  if (!link.error && hashedToken) {
    const verified = await authClient.auth.verifyOtp({ type: 'email', token_hash: hashedToken });
    if (verified.data.session && verified.data.user) {
      return { session: pickSession(verified.data.session), user: verified.data.user };
    }
    console.warn('[auth] magic-link mint failed, falling back', verified.error?.message);
  } else {
    console.warn('[auth] generateLink failed, falling back', link.error?.message);
  }

  // ⚠️ FALLBACK ONLY. This rotates the password, which revokes this account's
  // sessions on every other device — see the note at the top of this file. It is
  // here so a Supabase-side change to generateLink degrades logins instead of
  // breaking them, and the warnings above are how you find out it is being used.
  const password = randomBytes(32).toString('base64url');
  const updated = await admin.auth.admin.updateUserById(user.id, { password, email_confirm: true });
  if (updated.error) return { error: `update_password:${updated.error.message}` };

  const signedIn = await authClient.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session || !signedIn.data.user) {
    return { error: `password_sign_in:${signedIn.error?.message || 'missing_session'}` };
  }

  return { session: pickSession(signedIn.data.session), user: signedIn.data.user };
}

/** The four fields callers put in the URL fragment, and nothing else. */
function pickSession(session: {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}) {
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    token_type: session.token_type,
  };
}
