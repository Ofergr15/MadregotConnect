'use client';

import { useState, useEffect } from 'react';
import { Volume2, Vibrate, X, ChevronDown, ChevronUp } from 'lucide-react';

const DISMISS_KEY = 'watch_alerts_card_dismissed';

/**
 * Athlete-facing tip explaining that pushed workouts already beep/vibrate at
 * each step on the watch, and how to turn on Garmin Audio Prompts for spoken
 * pace/lap cues. This is the "A" of the A+B audio work — no watch integration
 * needed, just guidance. Dismissible and remembered in localStorage.
 */
export function WatchAlertsCard() {
  const [dismissed, setDismissed] = useState(true); // default hidden until we read storage
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISS_KEY) === '1');
  }, []);

  if (dismissed) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  return (
    <section className="bg-slate-800/30 rounded-2xl border border-slate-700/20 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="bg-primary-500/20 w-10 h-10 rounded-full flex items-center justify-center shrink-0">
          <Volume2 className="h-5 w-5 text-primary-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-white">Alerts & voice on your watch</h3>
            <button onClick={dismiss} className="text-slate-500 hover:text-white shrink-0" aria-label="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Your watch <span className="text-slate-200 font-medium">beeps and vibrates</span> at every
            step of the workout — including rest intervals — and shows your target pace on screen.
          </p>

          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs text-primary-400 hover:text-primary-300 mt-2"
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            Want spoken cues too?
          </button>

          {expanded && (
            <div className="mt-2 space-y-2 text-xs text-slate-400">
              <p className="flex items-start gap-2">
                <Vibrate className="h-3.5 w-3.5 text-slate-500 mt-0.5 shrink-0" />
                <span>
                  Step beeps &amp; vibration work automatically — no setup needed.
                </span>
              </p>
              <p className="flex items-start gap-2">
                <Volume2 className="h-3.5 w-3.5 text-slate-500 mt-0.5 shrink-0" />
                <span>
                  For spoken pace &amp; lap announcements, enable <span className="text-slate-200 font-medium">Audio Prompts</span> on
                  your Garmin (Settings → System → Audio Prompts) and connect Bluetooth headphones or your phone.
                </span>
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
