'use client';

// The first open of the app, onboarding v2 (lib/onboarding/first-run-flow): a
// personal welcome that says what is left and how long each part takes, then the
// notifications step with the phone's own popup shown in advance, a real test
// push when it worked, and the hand-off to the tour. One full-screen sequence, so
// nothing else pops up in the middle of it.

import { useCallback, useEffect, useState } from 'react';
import { mutate } from 'swr';
import { subscribeToPush } from '@/lib/pwa';
import { apiHeaders } from '@/lib/api';
import { logClient } from '@/lib/client-log';
import { useOnboarding, ONBOARDING_KEY } from '@/lib/onboarding/use-onboarding';
import { useInstallStep } from '@/components/onboarding/InstallStepProvider';
import { PUSH_STEP_DISMISS_KEY, PUSH_STEP_SESSION_SKIP_KEY, readPushPermission, recordPushStepSkipped } from '@/lib/onboarding/first-run-order';
import { readFirstRunStage, setFirstRunStage } from '@/lib/onboarding/first-run-flow';
import { useOnboardingV2 } from '@/lib/install/v2';
import { IosPermissionPreview } from '@/components/install/IosPermissionPreview';
import { useIsComputer } from '@/lib/install/use-computer';
import './first-run.css';

export type Stage = 'welcome' | 'push' | 'pushDone' | 'pushBlocked';

const CONFETTI: Array<[number, number, string, number]> = [
  [6, 10, '#FF5315', 20], [19, 4, '#FFD166', -30], [33, 12, '#9BA3FF', 45], [48, 5, '#06D6A0', 10],
  [62, 11, '#FF5315', -15], [76, 4, '#FFD166', 35], [89, 10, '#06D6A0', -40], [12, 22, '#9BA3FF', 25],
  [55, 20, '#FFD166', -10], [84, 21, '#FF5315', 50],
];

function firstNameOf(): string {
  try {
    const typed = localStorage.getItem('mc-first-name');
    if (typed) return typed;
    return (localStorage.getItem('athlete_name') || '').split(/\s+/)[0] || '';
  } catch {
    return '';
  }
}

function Dots({ at }: { at: 0 | 1 | 2 }) {
  return (
    <div className="flex justify-center gap-1.5" aria-label={`שלב ${at + 1} מתוך 3`}>
      {[0, 1, 2].map((i) => (
        <i key={i} className={`h-1.5 rounded-full transition-all ${i === at ? 'w-6 bg-brand-600' : i < at ? 'w-1.5 bg-accent-600' : 'w-1.5 bg-ink-300'}`} />
      ))}
    </div>
  );
}

/** `previewStage`: /preview/first-run only — draw that screen, skip every gate. */
export function FirstRunFlow({ previewStage }: { previewStage?: Stage } = {}) {
  const v2 = useOnboardingV2();
  const { data } = useOnboarding();
  const { answered: installAnswered } = useInstallStep();
  const [athleteId, setAthleteId] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage | null>(previewStage ?? null);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  // A computer (lib/install/platform isComputer): nothing was installed, and the
  // coach's notifications live on the phone, so the push step is not asked here.
  const computer = useIsComputer();

  useEffect(() => {
    if (previewStage) { setName('נועה'); return; }
    if (!v2 || stage || !data || !data.applicable || !installAnswered) return;
    if (data.migrated && data.tourSeen) return; // not a first run
    const id = localStorage.getItem('athlete_id');
    if (!id || readFirstRunStage(id)) return;
    setAthleteId(id);
    setName(firstNameOf());
    setStage('welcome');
  }, [v2, data, installAnswered, stage, previewStage]);

  const toTour = useCallback(() => {
    if (athleteId) setFirstRunStage(athleteId, 'tour');
    setStage(null);
  }, [athleteId]);

  const fromWelcome = useCallback(() => {
    if (computer) { toTour(); return; }
    // Nothing to ask on a phone that already answered, or cannot (a browser tab on
    // an iPhone): straight on to the tour.
    const p = readPushPermission();
    if (p === 'default') setStage('push');
    else if (p === 'denied') setStage('pushBlocked');
    else toTour();
  }, [toTour, computer]);

  const enable = async () => {
    setBusy(true);
    setSlow(false);
    setError(null);
    const slowTimer = setTimeout(() => setSlow(true), 4000);
    try {
      const result = await subscribeToPush(athleteId || '');
      logClient('push-first-run', { ok: result.ok, error: result.error });
      if (result.ok) {
        try { localStorage.setItem(PUSH_STEP_DISMISS_KEY, '1'); } catch { /* ignore */ }
        mutate(ONBOARDING_KEY);
        setStage('pushDone');
        // The proof: a real push to this phone, so they see what one looks like
        // and we see a delivery receipt.
        fetch('/api/push/test', { method: 'POST', headers: await apiHeaders(true), body: JSON.stringify({ athleteId }) }).catch(() => {});
        return;
      }
      if (result.error === 'permission_denied') { setStage('pushBlocked'); return; }
      setError(result.error ?? 'unknown');
    } finally {
      clearTimeout(slowTimer);
      setBusy(false);
    }
  };

  if (!stage) return null;

  return (
    <div className={computer ? 'fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-ink-900/40 p-6' : 'fixed inset-0 z-[70] overflow-y-auto bg-page'} dir="rtl" role="dialog" aria-modal="true" aria-label="ברוכים הבאים">
      <div className={computer
        ? 'flex w-full max-w-[560px] flex-col rounded-[28px] bg-page p-6 shadow-[0_24px_60px_rgba(0,0,0,0.25)]'
        : 'mx-auto flex min-h-full max-w-md flex-col px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-[max(20px,env(safe-area-inset-top))]'}>
        {stage === 'welcome' && (
          <>
            <div className="relative mt-2 overflow-hidden rounded-[28px] bg-gradient-to-br from-[#2b33ff] via-brand-600 to-[#6a5cff] px-5 pb-6 pt-7 text-center text-white shadow-[0_18px_40px_rgba(43,51,255,0.35)]">
              {CONFETTI.map(([x, y, c, r], i) => (
                <i key={i} aria-hidden className="frf-confetti absolute block h-3 w-2 rounded-[2px]" style={{ left: `${x}%`, top: `${y}%`, background: c, transform: `rotate(${r}deg)`, animationDelay: `${i * 90}ms` }} />
              ))}
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-white text-2xl font-black text-brand-600 shadow-[0_0_0_6px_rgba(255,255,255,0.25)]">
                {(name || 'מ').slice(0, 1)}
              </div>
              <p className="mt-4 text-2xs font-bold tracking-wide text-white/85">{computer ? 'אתם בפנים' : 'ההתקנה הצליחה · אתם בפנים'}</p>
              <h1 className="mt-1 text-[28px] font-black leading-tight">{name ? `${name}, ברוכים הבאים` : 'ברוכים הבאים'}<br />למדרגות 🎉</h1>
              <p className="mt-2 text-13 text-white/90">{computer ? 'מועדון הריצה שלך' : 'מועדון הריצה שלך, עכשיו בכיס'}</p>
            </div>
            <div className="mt-4 rounded-[22px] bg-card p-4 shadow-sm">
              <p className="text-sm font-black text-ink-700">3 דברים קטנים, ומתחילים לרוץ</p>
              {(computer ? [
                ['🧭', 'סיור קצר באפליקציה', 'איפה התוכנית, הפיד והפרופיל', '40 שנ׳'],
                ['⌚', 'השעון והפרופיל', 'כדי שהריצות ייכנסו לבד', 'דקה'],
                ['📱', 'האפליקציה בטלפון', 'שם מקבלים התראות מהמאמן ותזכורות', 'דקה'],
              ] : [
                ['🔔', 'התראות', 'שהמאמן יוכל לכתוב לך', '30 שנ׳'],
                ['🧭', 'סיור קצר באפליקציה', 'איפה התוכנית, הפיד והפרופיל', '40 שנ׳'],
                ['⌚', 'השעון והפרופיל', 'כדי שהריצות ייכנסו לבד', 'דקה'],
              ]).map(([icon, title, sub, time], i) => (
                <div key={i} className="mt-3 flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-page text-lg" aria-hidden>{icon}</span>
                  <div className="min-w-0 flex-1"><p className="text-sm font-bold text-ink-700">{title}</p><p className="text-xs text-ink-400">{sub}</p></div>
                  <span className="text-2xs font-bold text-ink-400">{time}</span>
                </div>
              ))}
            </div>
            <div className={computer ? 'pt-5' : 'mt-auto pt-6'}>
              <button type="button" onClick={fromWelcome} className="min-h-[56px] w-full rounded-pill bg-brand-600 text-lg font-black text-white shadow-[0_10px_24px_rgba(67,56,255,0.35)] active:bg-brand-700">
                יאללה, מתחילים
              </button>
            </div>
          </>
        )}

        {stage === 'push' && (
          <>
            <div className="mt-3"><Dots at={0} /></div>
            <div className="mt-6 text-center">
              <div className="frf-bell mx-auto flex h-20 w-20 items-center justify-center rounded-[26px] bg-brand-600/10 text-4xl" aria-hidden>🔔</div>
              <h2 className="mt-4 text-[23px] font-black leading-tight text-ink-700">שהמאמן יוכל לכתוב לך</h2>
              <p className="mx-auto mt-2 max-w-[310px] text-sm leading-relaxed text-ink-500">
                התראה כשהמאמן מגיב למשוב שלך, כשמישהו נותן לך kudos, ותזכורת יום לפני אימון.
              </p>
            </div>
            <IosPermissionPreview />
            {busy && slow && !error && <p className="mt-4 text-center text-xs text-ink-400">מסיימים להכין את האפליקציה בפעם הראשונה, עוד רגע…</p>}
            {error && (
              <p role="alert" className="mt-4 text-center text-xs font-semibold text-accent-red">
                {error === 'sw_not_ready' ? 'האפליקציה עוד מסיימת להתקין ברקע. נסו שוב בעוד דקה.' : 'זה לא עבד. בדקו את החיבור ונסו שוב.'}
              </p>
            )}
            <div className="mt-auto flex flex-col gap-2.5 pt-6">
              <button type="button" onClick={enable} disabled={busy} className="min-h-[56px] w-full rounded-pill bg-brand-600 text-lg font-black text-white active:bg-brand-700 disabled:opacity-60">
                {busy ? 'מפעילים…' : error ? 'לנסות שוב' : 'הפעלת התראות'}
              </button>
              <button
                type="button"
                onClick={() => {
                  // "Later" is a real answer: the old notifications sheet must not
                  // come straight back after the tour on this visit.
                  try { sessionStorage.setItem(PUSH_STEP_SESSION_SKIP_KEY, '1'); recordPushStepSkipped(); } catch { /* ignore */ }
                  toTour();
                }}
                className="min-h-[48px] w-full text-sm font-bold text-ink-400"
              >
                אחר כך
              </button>
            </div>
          </>
        )}

        {stage === 'pushDone' && (
          <>
            <div className="mt-3"><Dots at={1} /></div>
            <div className="mt-8 text-center">
              <div className="frf-pop mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-accent-600 text-4xl font-black text-white shadow-[0_12px_30px_rgba(22,163,74,0.35)]">✓</div>
              <h2 className="mt-5 text-[23px] font-black text-ink-700">מעולה, ההתראות פעילות</h2>
              <p className="mx-auto mt-2 max-w-[300px] text-sm leading-relaxed text-ink-500">שלחנו לך עכשיו התראת ניסיון, כדי שתראו איך זה נראה. היא תקפוץ בעוד שנייה.</p>
            </div>
            <div className="frf-push mx-auto mt-6 flex w-full max-w-[340px] items-center gap-3 rounded-[22px] bg-white/90 p-3 shadow-[0_12px_30px_rgba(20,24,60,0.14)] ring-1 ring-black/5" aria-hidden>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/icon-192.png" alt="" className="h-10 w-10 rounded-[10px]" />
              <div className="min-w-0 flex-1 text-start"><p className="text-13 font-bold text-ink-700">מדרגות</p><p className="text-xs text-ink-500">👋 ככה תשמעו מהמאמן ומהקבוצה</p></div>
              <span className="self-start text-3xs text-ink-400">עכשיו</span>
            </div>
            <div className="mt-auto pt-6">
              <button type="button" onClick={toTour} className="min-h-[56px] w-full rounded-pill bg-brand-600 text-lg font-black text-white active:bg-brand-700">לסיור קצר באפליקציה</button>
            </div>
          </>
        )}

        {stage === 'pushBlocked' && (
          <>
            <div className="mt-3"><Dots at={0} /></div>
            <div className="mt-8 text-center">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[26px] bg-[#FFF1E8] text-4xl" aria-hidden>🔕</div>
              <h2 className="mt-5 text-[22px] font-black text-ink-700">ההתראות כבויות בטלפון</h2>
              <p className="mx-auto mt-2 max-w-[310px] text-sm leading-relaxed text-ink-500">
                אפשר להדליק אותן בכל רגע: הגדרות ← מדרגות ← הודעות ← לאפשר הודעות. בינתיים נמשיך.
              </p>
            </div>
            <div className="mt-auto pt-6">
              <button type="button" onClick={toTour} className="min-h-[56px] w-full rounded-pill bg-brand-600 text-lg font-black text-white active:bg-brand-700">להמשיך לסיור</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
