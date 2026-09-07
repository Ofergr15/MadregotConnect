'use client';

import { getSupabase } from '@/lib/supabase/client';
import { clearIdentityKeys } from '@/lib/auth/identity-keys';
import { blockSilentReauth } from '@/lib/auth/silent-reauth';
import { clearPendingVerifier } from '@/lib/auth/login-handoff';

/**
 * Sign out for real, everywhere this browser keeps a claim to an identity.
 *
 * There are four of them and every sign-out button only ever cleared one:
 *
 *  1. the Supabase session in localStorage — what `auth.signOut()` handles;
 *  2. the identity keys (athlete_id, coach_email, admin_session, "view as", …);
 *  3. the signed httpOnly `mc_device` cookie, good for a YEAR, which the landing
 *     page trades for a brand-new session the moment you arrive there — this is
 *     why signing out looked like a refresh that left you logged in;
 *  4. a pending login verifier, which the same page will happily claim.
 *
 * Wrong in different ways in five places before this, so it lives here once.
 *
 * Never throws: nothing about a failed sign-out should trap somebody on the
 * screen they are trying to leave. Each step is independent, and the local ones
 * still run when the network call fails — the caller navigates regardless.
 */
export async function signOutEverywhere(): Promise<void> {
  // First, and awaited: while this cookie exists the landing page can put them
  // straight back in, so it has to be gone before we navigate there.
  try {
    await fetch('/api/auth/sign-out', { method: 'POST' });
  } catch {
    // Offline. The local wipe below still logs them out of this browser, and the
    // cookie alone cannot mint a session without the Supabase call that needs
    // the network anyway.
  }
  try {
    await getSupabase().auth.signOut();
  } catch {
    // A revoke that did not reach Supabase must not keep them here — the local
    // identity is what the shell reads, and that is cleared next.
  }
  // Belt and braces for a soft navigation, where the module keeps its state: the
  // latch stops any in-flight recovery from re-minting a session on the way out.
  blockSilentReauth();
  clearPendingVerifier();
  clearIdentityKeys();
}
