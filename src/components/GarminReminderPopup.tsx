'use client';

import { useState, useEffect } from 'react';
import { Watch, X } from 'lucide-react';

export function GarminReminderPopup() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (window.location.pathname.includes('/profile')) return;

    const role = localStorage.getItem('role');
    if (role === 'admin' || role === 'coach') return;

    const athleteId = localStorage.getItem('athlete_id');
    if (!athleteId) return;

    const dismissed = localStorage.getItem('garmin_reminder_dismissed');
    if (dismissed === 'forever') return;

    const sessionDismissed = sessionStorage.getItem('garmin_reminder_dismissed_session');
    if (sessionDismissed) return;

    let mounted = true;
    fetch(`/api/athletes/me?id=${athleteId}`)
      .then(res => res.json())
      .then(data => {
        if (mounted && data.athlete && !data.athlete.hasGarmin) {
          setShow(true);
        }
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  if (!show) return null;

  const handleRemindLater = () => {
    sessionStorage.setItem('garmin_reminder_dismissed_session', '1');
    setShow(false);
  };

  const handleDismissForever = () => {
    localStorage.setItem('garmin_reminder_dismissed', 'forever');
    setShow(false);
  };

  const handleConnect = () => {
    sessionStorage.setItem('garmin_reminder_dismissed_session', '1');
    window.location.href = '/dashboard/profile?connectGarmin=1';
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl border border-slate-700 p-6 w-full max-w-sm relative">
        <button
          onClick={handleRemindLater}
          className="absolute top-4 right-4 text-slate-400 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex flex-col items-center text-center">
          <div className="bg-primary-500/20 w-14 h-14 rounded-full flex items-center justify-center mb-4">
            <Watch className="h-7 w-7 text-primary-400" />
          </div>

          <h2 className="text-lg font-bold text-white">Connect Your Garmin</h2>
          <p className="text-sm text-slate-400 mt-2">
            Connect your Garmin watch to receive workouts directly on your wrist from your coach.
          </p>

          <button
            onClick={handleConnect}
            className="w-full mt-5 bg-primary-600 hover:bg-primary-700 text-white font-medium px-4 py-3 rounded-lg transition-colors"
          >
            Connect Garmin Now
          </button>

          <div className="flex gap-3 mt-3 w-full">
            <button
              onClick={handleRemindLater}
              className="flex-1 text-slate-400 hover:text-white text-sm py-2 transition-colors"
            >
              Remind Me Later
            </button>
            <button
              onClick={handleDismissForever}
              className="flex-1 text-slate-500 hover:text-slate-300 text-sm py-2 transition-colors"
            >
              Don&apos;t Show Again
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
