'use client';
import { useState } from 'react';

// Strava sign-in with the standalone-PWA handoff (restored from app/page.tsx as it was
// before #145). QA 26.11 (Q26-1) found the email sheet's Strava fallback calling
// `/api/strava?mode=login` bare: no challenge, no verifier, no clearLocalIdentity().
// In the installed PWA iOS opens the OAuth in a sheet with its own storage partition,
// so a session set there never reaches the app; the verifier below stays in THIS
// partition and is what claimPendingLogin() (app/page.tsx) redeems on the way back.
export function useStravaLogin() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    setLoading(true);
    setError(null);
    try {
      // Drop the previous person / stale JWT (shared phones) so /auth/resolve adopts the Strava user.
      const { clearLocalIdentity } = await import('@/lib/auth/clear-local-identity');
      await clearLocalIdentity();
      // Stored after clearLocalIdentity, not before: that call clears keys.
      const { newVerifier, challengeFor, storePendingVerifier } = await import('@/lib/auth/login-handoff');
      const verifier = newVerifier();
      const challenge = await challengeFor(verifier);
      storePendingVerifier(verifier);

      const res = await fetch(`/api/strava?mode=login&challenge=${encodeURIComponent(challenge)}`);
      const data = await res.json();
      if (!res.ok || !data.authUrl) throw new Error(data.message || data.error || 'Strava login unavailable');
      window.location.href = data.authUrl;
    } catch (err) {
      console.error(err);
      setError('לא הצלחנו לפתוח את Strava, נסו שוב');
      setLoading(false);
    }
  };

  return { signIn, loading, error };
}
