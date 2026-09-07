'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Activity, Watch, X } from 'lucide-react';
import { apiHeaders } from '@/lib/api';
import { connectPromptVariant, type ConnectPromptVariant } from '@/lib/connect-prompt';

/**
 * First-run "connect your training data" nudge (roadmap flow #22, step 2).
 *
 * Google Sign-In only creates the account — it carries no Strava/Garmin
 * token, so a brand-new (or Google-only) athlete lands on the dashboard with
 * neither data source connected. This is a soft, dismissible prompt (not a
 * hard redirect/gate) pointing at the existing profile "Activity Data
 * Source" section (Strava + Garmin connect, built in
 * dashboard/profile/page.tsx — not duplicated here), with a "log it by hand"
 * fallback for athletes who have neither device/app.
 *
 * Was `GarminReminderPopup` (Garmin-only, unused/never mounted anywhere).
 * Renamed + extended to also clear when Strava is connected, and to surface
 * the manual-entry fallback, then mounted in the dashboard layout.
 *
 * It asks one of two different questions — see connectPromptVariant(). "Connect
 * Strava or Garmin" is the right ask of an account with neither, and the wrong one
 * of a Strava-only member: their runs already arrive, and what they are actually
 * missing is the only channel a coach's workout can take to a watch. Since a Strava
 * sign-in no longer walks /join (where the Garmin step lives), that member is now
 * the common case rather than an edge one, so the Garmin ask has its own copy and
 * drops the manual-logging fallback, which would make no sense to somebody whose
 * runs are already flowing in.
 */
export function ConnectDataSourcePopup() {
  const router = useRouter();
  const t = useTranslations('connectPrompt');
  const [variant, setVariant] = useState<ConnectPromptVariant>('none');

  useEffect(() => {
    if (window.location.pathname.includes('/profile')) return;
    if (window.location.pathname.includes('/activities')) return;

    // Staff don't get nagged to connect a watch. This read `localStorage.role`,
    // a key nothing in the app has ever written — so the bypass never fired and
    // coaches got the popup on every dashboard page. These are the keys that
    // actually exist (same test as dashboard/program's isAdmin).
    const isStaff =
      localStorage.getItem('admin_session') === 'true' || !!localStorage.getItem('coach_email');
    if (isStaff) return;

    const athleteId = localStorage.getItem('athlete_id');
    if (!athleteId) return;

    const dismissed = localStorage.getItem('connect_data_source_dismissed');
    if (dismissed === 'forever') return;

    const sessionDismissed = sessionStorage.getItem('connect_data_source_dismissed_session');
    if (sessionDismissed) return;

    let mounted = true;
    apiHeaders()
      .then(headers => fetch(`/api/athletes/me?id=${athleteId}`, { headers }))
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (mounted && data?.athlete) setVariant(connectPromptVariant(data.athlete));
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  if (variant === 'none') return null;

  // Both asks share one "stop asking me" switch. Someone who said never when they
  // had nothing connected is not asked again for having connected only half of it.
  const garminOnly = variant === 'garmin';

  const handleRemindLater = () => {
    sessionStorage.setItem('connect_data_source_dismissed_session', '1');
    setVariant('none');
  };

  const handleDismissForever = () => {
    localStorage.setItem('connect_data_source_dismissed', 'forever');
    setVariant('none');
  };

  const handleConnect = () => {
    sessionStorage.setItem('connect_data_source_dismissed_session', '1');
    setVariant('none');
    router.push('/dashboard/profile?connectGarmin=1');
  };

  const handleLogManually = () => {
    sessionStorage.setItem('connect_data_source_dismissed_session', '1');
    setVariant('none');
    router.push('/dashboard/activities?logManual=1');
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
      <div className="bg-card rounded-card border border-page p-6 w-full max-w-sm relative">
        <button
          onClick={handleRemindLater}
          className="absolute top-4 end-4 text-ink-400 hover:text-ink-900"
          aria-label={t('close')}
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex flex-col items-center text-center">
          <div className="bg-brand-600/20 w-14 h-14 rounded-full flex items-center justify-center mb-4">
            {garminOnly
              ? <Watch className="h-7 w-7 text-brand-600" />
              : <Activity className="h-7 w-7 text-brand-600" />}
          </div>

          <h2 className="text-lg font-bold text-ink-700">{t(garminOnly ? 'garminTitle' : 'title')}</h2>
          <p className="text-sm text-ink-400 mt-2">
            {t(garminOnly ? 'garminDescription' : 'description')}
          </p>

          <button
            onClick={handleConnect}
            className="w-full mt-5 bg-brand-600 hover:bg-brand-700 text-white font-medium px-4 py-3 rounded-lg transition-colors"
          >
            {t(garminOnly ? 'garminConnectNow' : 'connectNow')}
          </button>

          {/* Pointless for the Garmin ask: their runs already arrive from Strava. */}
          {!garminOnly && (
            <button
              onClick={handleLogManually}
              className="w-full mt-2 text-brand-600 hover:text-brand-700 text-sm py-1.5 transition-colors"
            >
              {t('logManually')}
            </button>
          )}

          <div className="flex gap-3 mt-3 w-full">
            <button
              onClick={handleRemindLater}
              className="flex-1 text-ink-400 hover:text-ink-900 text-sm py-2 transition-colors"
            >
              {t('remindLater')}
            </button>
            <button
              onClick={handleDismissForever}
              className="flex-1 text-ink-400 hover:text-ink-500 text-sm py-2 transition-colors"
            >
              {t(garminOnly ? 'noGarmin' : 'dontShowAgain')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
