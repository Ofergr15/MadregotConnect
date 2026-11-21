'use client';

import { useState } from 'react';
import { apiHeaders } from '@/lib/api';

/**
 * Starts linking Strava to `athleteId` (GET /api/strava?athleteId — self-or-staff, and the
 * state it returns is signed and single-use). Navigates to Strava on success. On a refusal
 * (403 not allowed, 503 could not start, a body without authUrl, a network error) it
 * reports `failed` and gives the button back — it used to stay on "connecting" forever.
 */
export async function startStravaLink(
  athleteId: string,
  opts: { switchAccount?: boolean } = {},
  deps: { fetch?: typeof fetch; headers?: () => Promise<HeadersInit>; go?: (url: string) => void } = {},
): Promise<'redirected' | 'failed'> {
  const doFetch = deps.fetch ?? fetch;
  const go = deps.go ?? ((url: string) => { window.location.href = url; });
  try {
    const res = await doFetch(`/api/strava?athleteId=${encodeURIComponent(athleteId)}${opts.switchAccount ? '&switch=1' : ''}`, {
      headers: await (deps.headers ?? (() => apiHeaders()))(),
    });
    const data = (await res.json().catch(() => null)) as { authUrl?: string } | null;
    if (res.ok && data?.authUrl) { go(data.authUrl); return 'redirected'; }
    return 'failed';
  } catch {
    return 'failed';
  }
}

export function StravaConnectButton({ athleteId, label, connectingLabel, switchAccount, onFailed, className }: {
  athleteId: string;
  label: string;
  connectingLabel: string;
  /** approval_prompt=force, so Strava shows which athlete it is about to connect. */
  switchAccount?: boolean;
  onFailed?: () => void;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      className={className}
      onClick={async () => {
        setBusy(true);
        const r = await startStravaLink(athleteId, { switchAccount });
        if (r === 'failed') { setBusy(false); onFailed?.(); }
      }}
    >
      {busy ? connectingLabel : label}
    </button>
  );
}
