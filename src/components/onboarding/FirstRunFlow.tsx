'use client';

// The first open of the app, onboarding v2 (lib/onboarding/first-run-flow): a
// personal welcome that says what is left and how long each part takes, then the
// notifications step with the phone's own popup shown in advance, a real test
// push when it worked, and the hand-off to the tour. One full-screen sequence, so
// nothing else pops up in the middle of it.
//
// Drawn in the joining journey's one look (journey-ui: sunset header, cream page,
// one primary pill). The welcome lists ONLY the steps that will actually run on
// this device (journey audit, 2026-10-10: it promised notifications in a browser
// tab that can't be asked, and "the watch and the profile", which never ran):
//   · notifications — only when this device can be asked (askablePush below);
//   · the tour — always;
//   · the watch — only while none is connected. The next thing after the tour is
//     then the feed's setup checklist, which leads with it, and the "connect your
//     data" popup waits while that checklist is up (ConnectDataSourcePopup).

import { useCallback, useEffect, useState } from 'react';
import { mutate } from 'swr';
import { isIosDevice, isStandalone, subscribeToPush } from '@/lib/pwa';
import { apiHeaders } from '@/lib/api';
import { logClient } from '@/lib/client-log';
import { useOnboarding, ONBOARDING_KEY } from '@/lib/onboarding/use-onboarding';
import { useInstallStep } from '@/components/onboarding/InstallStepProvider';
import { PUSH_STEP_DISMISS_KEY, PUSH_STEP_SESSION_SKIP_KEY, readPushPermission, recordPushStepSkipped } from '@/lib/onboarding/first-run-order';
import { readFirstRunStage, setFirstRunStage } from '@/lib/onboarding/first-run-flow';
import { useOnboardingV2 } from '@/lib/install/v2';
import { IosPermissionPreview } from '@/components/install/IosPermissionPreview';
import { useIsComputer } from '@/lib/install/use-computer';
import { JOURNEY, JourneyCard, JourneyHero, JourneyRow, JourneyScreen, PrimaryButton, SecondaryButton } from './journey-ui';
import './first-run.css';
import { trackOnb } from '@/lib/onboarding/track';

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

/**
 * Can THIS device be asked for notifications right now? Not on a computer (the
 * coach's notifications live on the phone), not when the browser has no push or
 * already answered, and not in an iPhone's Safari tab — a subscription made there
 * is page-origin for good (lib/onboarding/first-run-order). The welcome's list and
 * the step after it both read this, so the list never promises a step that won't run.
 */
function askablePush(computer: boolean): boolean {
  if (computer) return false;
  if (readPushPermission() !== 'default') return false;
  return !(isIosDevice() && !isStandalone());
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
  // Read on the client once the welcome arms (window APIs), see askablePush.
  const [canAskPush, setCanAskPush] = useState(false);
  const [standalone, setStandalone] = useState(false);
  useEffect(() => {
    if (stage !== 'welcome') return;
    setCanAskPush(askablePush(computer));
    setStandalone(isStandalone());
  }, [stage, computer]);
  // The watch row only while nothing is connected (the setup task "watch").
  const needsWatch = !!data && data.applicable && !!data.tasks?.some((task) => task.key === 'watch' && !task.done);

  useEffect(() => {
    if (previewStage) { setName('נועה'); return; }
    if (!v2 || stage || !data || !data.applicable || !installAnswered) return;
    if (data.migrated && data.tourSeen) return; // not a first run
    const id = localStorage.getItem('athlete_id');
    if (!id || readFirstRunStage(id)) return;
    setAthleteId(id);
    setName(firstNameOf());
    setStage('welcome');
    trackOnb('first_run_start', { once: true });
  }, [v2, data, installAnswered, stage, previewStage]);

  const toTour = useCallback(() => {
    if (athleteId) setFirstRunStage(athleteId, 'tour');
    setStage(null);
  }, [athleteId]);

  const fromWelcome = useCallback(() => {
    if (computer) { toTour(); return; }
    // Nothing to ask on a phone that already answered, or cannot (a browser tab on
    // an iPhone): straight on to the tour. Same test as the welcome's list.
    if (askablePush(computer)) { setStage('push'); trackOnb('push_prompted', { once: true }); }
    else if (readPushPermission() === 'denied') setStage('pushBlocked');
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
        trackOnb('push_granted');
        // The proof: a real push to this phone, so they see what one looks like
        // and we see a delivery receipt.
        fetch('/api/push/test', { method: 'POST', headers: await apiHeaders(true), body: JSON.stringify({ athleteId }) }).catch(() => {});
        return;
      }
      if (result.error === 'permission_denied') { setStage('pushBlocked'); trackOnb('push_denied'); return; }
      setError(result.error ?? 'unknown');
    } finally {
      clearTimeout(slowTimer);
      setBusy(false);
    }
  };

  if (!stage) return null;

  const pushSteps = canAskPush ? 3 : 2;
  const stepsLeft: Array<[string, string, string, string]> = [
    ...(canAskPush ? [['🔔', 'התראות', 'שהמאמן יוכל לכתוב לכם', '30 שנ׳'] as [string, string, string, string]] : []),
    ['🧭', 'סיור של דקה', 'פיד, תוכנית, פרופיל', '40 שנ׳'],
    ...(needsWatch ? [['⌚', 'חיבור השעון', 'כדי שהריצות ייכנסו לבד', 'דקה'] as [string, string, string, string]] : []),
  ];
  const countLine = stepsLeft.length === 1 ? 'עוד דבר אחד קטן, ומתחילים לרוץ' : `עוד ${stepsLeft.length} דברים קטנים, ומתחילים לרוץ`;

  // The step counter of the notifications screens, in the journey's colours.
  const dots = (at: number) => (
    // Spans, not divs: JourneyHero puts the eyebrow inside a <p>.
    <span className="mb-1 flex justify-center gap-1.5" role="img" aria-label={`שלב ${at + 1} מתוך ${pushSteps}`}>
      {Array.from({ length: pushSteps }, (_, i) => (
        <i key={i} className={`block h-1.5 rounded-full transition-all ${i === at ? 'w-6' : 'w-1.5'}`} style={{ background: i === at ? '#fff' : i < at ? JOURNEY.eyebrow : 'rgba(255,255,255,0.4)' }} />
      ))}
    </span>
  );

  let screen: React.ReactNode = null;

  if (stage === 'welcome') {
    screen = (
      <JourneyScreen
        hero={(
          <div className="relative overflow-hidden rounded-b-[28px] md:rounded-b-none md:rounded-t-[28px]">
            <JourneyHero
              badge={(
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-white text-2xl font-black shadow-[0_0_0_6px_rgba(255,255,255,0.25)]" style={{ color: JOURNEY.dusk }}>
                  {(name || 'מ').slice(0, 1)}
                </div>
              )}
              eyebrow={!computer && standalone ? 'ההתקנה הצליחה · אתם בפנים' : 'אתם בפנים'}
              title={<>{name ? `${name}, ברוכים הבאים` : 'ברוכים הבאים'} 🎉</>}
              subtitle="למדרגות, מועדון הריצה שלכם"
            />
            {CONFETTI.map(([x, y, c, r], i) => (
              <i key={i} aria-hidden className="frf-confetti pointer-events-none absolute block h-3 w-2 rounded-[2px]" style={{ left: `${x}%`, top: `${y}%`, background: c, transform: `rotate(${r}deg)`, animationDelay: `${i * 90}ms` }} />
            ))}
          </div>
        )}
        actions={<PrimaryButton onClick={fromWelcome}>יאללה, מתחילים</PrimaryButton>}
      >
        <JourneyCard className="md:border md:border-[#EDE3DC]">
          <p className="text-[15px] font-black" style={{ color: JOURNEY.ink }}>{countLine}</p>
          <div className="mt-1">
            {stepsLeft.map(([icon, title, sub, time]) => (
              <JourneyRow key={title} icon={icon} title={title} sub={sub} end={<span className="mt-2.5 text-13 font-bold" style={{ color: JOURNEY.muted }}>{time}</span>} />
            ))}
          </div>
        </JourneyCard>
      </JourneyScreen>
    );
  }

  if (stage === 'push') {
    screen = (
      <JourneyScreen
        hero={<JourneyHero compact eyebrow={dots(0)} title="שהמאמן יוכל לכתוב לכם" subtitle="התראה כשהמאמן מגיב למשוב, כשמישהו מהקבוצה נותן לייק, ותזכורת יום לפני אימון." />}
        actions={(
          <>
            <PrimaryButton onClick={enable} disabled={busy}>
              {busy ? 'מפעילים…' : error ? 'לנסות שוב' : 'הפעלת התראות'}
            </PrimaryButton>
            <SecondaryButton
              onClick={() => {
                // "Later" is a real answer: the old notifications sheet must not
                // come straight back after the tour on this visit.
                try { sessionStorage.setItem(PUSH_STEP_SESSION_SKIP_KEY, '1'); recordPushStepSkipped(); } catch { /* ignore */ } trackOnb('push_later');
                toTour();
              }}
            >
              אחר כך
            </SecondaryButton>
          </>
        )}
      >
        <div className="frf-bell mx-auto mt-2 flex h-20 w-20 items-center justify-center rounded-[26px] text-4xl" style={{ background: JOURNEY.tagBg }} aria-hidden>🔔</div>
        <IosPermissionPreview />
        {busy && slow && !error && <p className="text-center text-13" style={{ color: JOURNEY.soft }}>מסיימים להכין את האפליקציה בפעם הראשונה, עוד רגע…</p>}
        {error && (
          <p role="alert" className="text-center text-13 font-bold" style={{ color: JOURNEY.red }}>
            {error === 'sw_not_ready' ? 'האפליקציה עוד מסיימת להתקין ברקע. נסו שוב בעוד דקה.' : 'זה לא עבד. כדאי לבדוק את החיבור ולנסות שוב.'}
          </p>
        )}
      </JourneyScreen>
    );
  }

  if (stage === 'pushDone') {
    screen = (
      <JourneyScreen
        hero={<JourneyHero compact eyebrow={dots(1)} title="מעולה, ההתראות פעילות" subtitle="שלחנו עכשיו התראת ניסיון, כדי שתראו איך זה נראה. היא תקפוץ בעוד שנייה." />}
        actions={<PrimaryButton onClick={toTour}>לסיור קצר באפליקציה</PrimaryButton>}
      >
        <div className="frf-pop mx-auto mt-4 flex h-20 w-20 items-center justify-center rounded-full text-4xl font-black text-white" style={{ background: JOURNEY.sun, boxShadow: '0 12px 30px rgba(240,100,60,0.35)' }}>✓</div>
        <div className="frf-push mx-auto mt-4 flex w-full max-w-[340px] items-center gap-3 rounded-[22px] bg-white p-3 shadow-[0_12px_30px_rgba(20,24,60,0.14)] ring-1 ring-black/5" aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/icon-192.png" alt="" className="h-10 w-10 rounded-[10px]" />
          <div className="min-w-0 flex-1 text-start"><p className="text-13 font-bold" style={{ color: JOURNEY.ink }}>מדרגות</p><p className="text-13" style={{ color: JOURNEY.soft }}>👋 ככה תשמעו מהמאמן ומהקבוצה</p></div>
          <span className="self-start text-13" style={{ color: JOURNEY.muted }}>עכשיו</span>
        </div>
      </JourneyScreen>
    );
  }

  if (stage === 'pushBlocked') {
    screen = (
      <JourneyScreen
        hero={<JourneyHero compact eyebrow={dots(0)} title="ההתראות כבויות בטלפון" subtitle="אפשר להדליק אותן בכל רגע, ובינתיים ממשיכים." />}
        actions={<PrimaryButton onClick={toTour}>להמשיך לסיור</PrimaryButton>}
      >
        <div className="mx-auto mt-2 flex h-20 w-20 items-center justify-center rounded-[26px] text-4xl" style={{ background: JOURNEY.tagBg }} aria-hidden>🔕</div>
        <JourneyCard>
          <JourneyRow icon="⚙️" title="איך מדליקים" sub="הגדרות ← מדרגות ← הודעות ← לאפשר הודעות" />
        </JourneyCard>
      </JourneyScreen>
    );
  }

  return (
    // The whole sequence covers the app on both layouts; JourneyScreen draws a
    // full page on a phone and one centred card on a computer.
    <div className="fixed inset-0 z-[70] overflow-y-auto" role="dialog" aria-modal="true" aria-label="ברוכים הבאים">
      {screen}
    </div>
  );
}
