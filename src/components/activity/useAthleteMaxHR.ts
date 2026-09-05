'use client';

import { useCallback } from 'react';
import { useApi } from '@/lib/api';
import { activityLocalDateStr } from '@/lib/utils';
import { DEFAULT_MAX_HR, estimatedMaxHR } from '@/components/activity/format';

/**
 * The max heart rate to draw an athlete's zones against — 220 − age where we may
 * know their age, and the 190 fallback everywhere else.
 *
 * ── Why it goes through /api/athletes/me ─────────────────────────────────────
 * That route is already self-or-staff gated on the `id` it's given, so this hook
 * gets a real birth date when the viewer is the athlete or their coach, and a 403
 * (→ fallback) when a teammate opens the same run. No new endpoint, no new
 * exposure: a birth date is PII, and "everyone in the club can read everyone's age
 * to the year" is a product decision nobody has made. A teammate keeps seeing
 * zones drawn against 190, exactly as before.
 *
 * The zones are shaded, not clinical, so a wrong fallback is a cosmetic miss —
 * which is why nothing here blocks on the request.
 *
 * Returns a function of the run's start time rather than a bare number: age ticks
 * over on a birthday, and a run from two years ago should be zoned against the age
 * the athlete was when they ran it.
 */
export function useAthleteMaxHR(athleteId: string | null | undefined) {
  const { data } = useApi<{ athlete?: { birthDate?: string | null } }>(
    athleteId ? `/api/athletes/me?id=${encodeURIComponent(athleteId)}` : null,
    // A birth date does not change. One fetch per athlete per session is plenty,
    // and this hook can mount once per card in a list.
    { revalidateOnFocus: false, revalidateIfStale: false, errorRetryCount: 0 },
  );
  const birthDate = data?.athlete?.birthDate ?? null;

  return useCallback(
    (startTime: string | null | undefined) =>
      startTime ? estimatedMaxHR(birthDate, activityLocalDateStr(startTime)) : DEFAULT_MAX_HR,
    [birthDate],
  );
}
