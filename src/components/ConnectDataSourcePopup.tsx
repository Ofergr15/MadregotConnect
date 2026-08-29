'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Activity, X } from 'lucide-react';

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
 */
export function ConnectDataSourcePopup() {
  const router = useRouter();
  const t = useTranslations('connectPrompt');
  const [show, setShow] = useState(false);

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
    fetch(`/api/athletes/me?id=${athleteId}`)
      .then(res => res.json())
      .then(data => {
        if (mounted && data.athlete && !data.athlete.hasGarmin && !data.athlete.hasStrava) {
          setShow(true);
        }
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  if (!show) return null;

  const handleRemindLater = () => {
    sessionStorage.setItem('connect_data_source_dismissed_session', '1');
    setShow(false);
  };

  const handleDismissForever = () => {
    localStorage.setItem('connect_data_source_dismissed', 'forever');
    setShow(false);
  };

  const handleConnect = () => {
    sessionStorage.setItem('connect_data_source_dismissed_session', '1');
    setShow(false);
    router.push('/dashboard/profile?connectGarmin=1');
  };

  const handleLogManually = () => {
    sessionStorage.setItem('connect_data_source_dismissed_session', '1');
    setShow(false);
    router.push('/dashboard/activities?logManual=1');
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
      <div className="bg-slate-800 rounded-2xl border border-slate-700 p-6 w-full max-w-sm relative">
        <button
          onClick={handleRemindLater}
          className="absolute top-4 end-4 text-slate-400 hover:text-white"
          aria-label={t('close')}
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex flex-col items-center text-center">
          <div className="bg-primary-500/20 w-14 h-14 rounded-full flex items-center justify-center mb-4">
            <Activity className="h-7 w-7 text-primary-400" />
          </div>

          <h2 className="text-lg font-bold text-white">{t('title')}</h2>
          <p className="text-sm text-slate-400 mt-2">
            {t('description')}
          </p>

          <button
            onClick={handleConnect}
            className="w-full mt-5 bg-primary-600 hover:bg-primary-700 text-white font-medium px-4 py-3 rounded-lg transition-colors"
          >
            {t('connectNow')}
          </button>

          <button
            onClick={handleLogManually}
            className="w-full mt-2 text-primary-400 hover:text-primary-300 text-sm py-1.5 transition-colors"
          >
            {t('logManually')}
          </button>

          <div className="flex gap-3 mt-3 w-full">
            <button
              onClick={handleRemindLater}
              className="flex-1 text-slate-400 hover:text-white text-sm py-2 transition-colors"
            >
              {t('remindLater')}
            </button>
            <button
              onClick={handleDismissForever}
              className="flex-1 text-slate-400 hover:text-slate-300 text-sm py-2 transition-colors"
            >
              {t('dontShowAgain')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
