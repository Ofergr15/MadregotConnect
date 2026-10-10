'use client';

// The install guide, full screen: the steps one at a time, each with a picture
// of what the member sees, in the joining journey's look (journey-ui: the sunset
// header, the cream page, ONE primary pill in a bottom bar that never scrolls
// away). Built for the member who has never added anything to a home screen: one
// instruction per screen, no jargon, a way out on every screen.
//
// Steps only (Ofer, 2026-10-10): it used to open on a dark video screen that
// then showed the very same steps again, and on the landing page on a welcome
// screen before that. Both are gone from the flow; the video components stay for
// /preview/install (`forceVideo`). On a 390×664 phone everything fits: the
// picture takes what is left over (max ~half the screen), the "next" control is
// always on screen, and the arrow toward Safari's own button sits in the flow at
// the bottom edge instead of floating over the instructions.
//
// Shared by the in-app install step (InstallPrompt), the end of /join and the
// landing page on an iPhone (blocking). Every showing marks the device
// (INSTALL_GUIDE_SEEN_KEY), so the app itself does not open it full screen again.

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import { detectInstallPlatform, otherSafari, type InstallPlatform } from '@/lib/install/platform';
import { stepsFor, VIDEO_STEP_MS, type InstallStep } from '@/lib/install/steps';
import { JOURNEY, JourneyHero, PrimaryButton, SecondaryButton } from '@/components/onboarding/journey-ui';
import { InstallScene } from './InstallScene';
import './install.css';

export const VIDEO_SEEN_KEY = 'mc-install-video-seen';
/**
 * This device has been shown the guide (anywhere: the landing page, the end of
 * /join, the app). Read by InstallPrompt so the guide shows ONCE — after that the
 * app only offers a small strip that reopens it on request. Under the
 * `pwa_install_` prefix so the super user's onboarding test reset clears it, and
 * deliberately NOT cleared by resetInstallOffer(): reopening is an explicit ask.
 */
export const INSTALL_GUIDE_SEEN_KEY = 'pwa_install_guide_seen';
const HELP_WHATSAPP = process.env.NEXT_PUBLIC_HELP_WHATSAPP || '';

const DEVICE_LABEL: Record<InstallPlatform, string> = {
  'ios-safari': 'אייפון · Safari',
  'ios-safari-26': 'אייפון · Safari',
  'ios-safari-compact': 'אייפון · Safari',
  'ios-inapp': 'אייפון · בתוך אפליקציה אחרת',
  android: 'אנדרואיד · Chrome',
  'android-inapp': 'אנדרואיד · בתוך אפליקציה אחרת',
  desktop: 'מחשב',
  standalone: '',
};

export interface InstallGuideProps {
  /** Chromium handed us `beforeinstallprompt`: the first Android step is a real button. */
  canPrompt: boolean;
  onInstall?: () => Promise<void>;
  /** "Not now" — back next visit. */
  onLater: () => void;
  /** "סיימתי" on the last step: the member says they added it. Defaults to onLater. */
  onDone?: () => void;
  /** "Don't offer again". Omitted where it makes no sense (the end of /join). */
  onNever?: () => void;
  /** Who is asking for help, for the pre-written WhatsApp message. */
  memberName?: string | null;
  /**
   * The landing page on an iPhone browser (onboarding v2): installing is the only
   * way in, so there is no "not now", the last step says to open the icon, and
   * the one way out is a quiet "can't install? sign in here" (onEscape).
   */
  blocking?: boolean;
  onEscape?: () => void;
  /** /preview/install only: draw this platform instead of detecting one. */
  forcePlatform?: InstallPlatform;
  /** /preview/install only: open on the (retired) video. The real flow always opens on step 1. */
  forceVideo?: boolean;
}

function helpLink(platform: InstallPlatform, step: number, name?: string | null): string | null {
  if (!HELP_WHATSAPP) return null;
  const who = name ? `אני ${name}, ` : '';
  const text = `היי, ${who}נתקעתי בהתקנת האפליקציה של מדרגות (${DEVICE_LABEL[platform]}, צעד ${step + 1}).`;
  return `https://wa.me/${HELP_WHATSAPP}?text=${encodeURIComponent(text)}`;
}

export function Qr({ url }: { url: string }) {
  const svg = useMemo(() => {
    const q = qrcode(0, 'M');
    q.addData(url);
    q.make();
    return q.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
  }, [url]);
  return <div className="mx-auto w-[190px] rounded-2xl bg-white p-2 shadow-sm [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/**
 * A real screenshot of the step, the control to press ringed. Sized by HEIGHT (the
 * box the guide leaves for it), its width following the picture's own shape, so
 * the ring's percentages land on the same pixels at any size. The frame is a
 * shadow, not a border, so it doesn't bend that shape.
 */
function StepShot({ shot }: { shot: NonNullable<InstallStep['shot']> }) {
  const r = shot.ring;
  return (
    <div className="relative h-full max-w-full overflow-hidden rounded-[22px] shadow-[0_0_0_4px_#111,0_14px_34px_rgba(20,24,60,0.22)]" style={{ aspectRatio: '603 / 1311' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={shot.src} alt="" className="block h-full w-full object-cover" />
      <span
        aria-hidden
        className="ig-shot-ring absolute"
        style={{ left: `${r.x - r.w / 2}%`, top: `${r.y - r.h / 2}%`, width: `${r.w}%`, height: `${r.h}%`, borderRadius: r.round ? 9999 : 12 }}
      />
    </div>
  );
}

/**
 * The real install video (an iPhone, recorded on Ofer's own phone): muted so the
 * phone lets it start by itself, captions burned in, a way out at the top, and it
 * hands over to the steps when it ends.
 */
function RealVideo({ onDone }: { onDone: () => void }) {
  return (
    <div className="ig-video" role="dialog" aria-modal="true" aria-label="סרטון התקנה" dir="rtl" data-testid="install-video">
      <div className="mb-3 flex items-center justify-between">
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs">איך מתקינים · 30 שניות</span>
        <button type="button" onClick={onDone} className="min-h-[40px] rounded-full bg-white px-4 text-sm font-black text-[#0b0e2e]">דילוג ←</button>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-hidden rounded-[22px] bg-black">
        <video
          src="/videos/install-iphone.mp4"
          poster="/videos/install-iphone-poster.jpg"
          autoPlay
          muted
          playsInline
          onEnded={onDone}
          className="h-full max-h-full w-auto"
        />
      </div>
      <p className="mt-2 text-center text-xs text-white/70">אחרי הסרטון נעבור על זה יחד, צעד אחד בכל פעם</p>
    </div>
  );
}

/** The video: every step's drawing in turn, with its caption, and a way out at the top. */
function InstallVideo({ steps, browser, onDone }: { steps: InstallStep[]; browser: 'Safari' | 'Chrome'; onDone: () => void }) {
  const [elapsed, setElapsed] = useState(0);
  const total = steps.length * VIDEO_STEP_MS;
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => {
      const e = Date.now() - started;
      setElapsed(e);
      if (e >= total) { clearInterval(id); onDone(); }
    }, 120);
    return () => clearInterval(id);
  }, [total, onDone]);
  const i = Math.min(steps.length - 1, Math.floor(elapsed / VIDEO_STEP_MS));
  const s = steps[i];
  const secs = Math.max(0, Math.ceil((total - elapsed) / 1000));
  return (
    <div className="ig-video" role="dialog" aria-modal="true" aria-label="סרטון התקנה" dir="rtl" data-testid="install-video">
      <div className="mb-3 flex items-center justify-between">
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs">איך מתקינים · {secs} שניות</span>
        <button type="button" onClick={onDone} className="min-h-[40px] rounded-full bg-white px-4 text-sm font-black text-[#0b0e2e]">
          דילוג ←
        </button>
      </div>
      <div className="ig-vstage">
        <div key={`s${i}`} className="ig-vscene" style={{ marginBottom: 80 }}><InstallScene scene={s.scene} browser={browser} /></div>
        <div key={`c${i}`} className="ig-vcap"><span className="opacity-70">{i + 1}. </span>{s.caption}</div>
      </div>
      <div className="ig-vbar"><i style={{ width: `${Math.min(100, (elapsed / total) * 100)}%` }} /></div>
      <p className="mt-2 text-center text-xs text-white/70">אחרי הסרטון נעבור על זה יחד, צעד אחד בכל פעם</p>
    </div>
  );
}

interface BeforeInstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * The English menu names in the steps ("(Add to Home Screen)") isolated as one
 * left-to-right unit that never breaks: left to the bidi algorithm inside a Hebrew
 * line, the parentheses flipped and the words split across two lines.
 */
function ltrParens(text: string): ReactNode {
  return text.split(/(\([A-Za-z][^)]*\))/).map((part, i) =>
    i % 2 ? <bdi key={i} dir="ltr" className="whitespace-nowrap">{part}</bdi> : part);
}

export function InstallGuide({ canPrompt: given, onInstall: givenInstall, onLater, onDone, onNever, memberName, forcePlatform, forceVideo, blocking, onEscape }: InstallGuideProps) {
  // Where no provider caught Chrome's install event (the end of /join), catch it here.
  const [own, setOwn] = useState<BeforeInstallPrompt | null>(null);
  useEffect(() => {
    if (givenInstall) return;
    const on = (e: Event) => { e.preventDefault(); setOwn(e as BeforeInstallPrompt); };
    window.addEventListener('beforeinstallprompt', on);
    return () => window.removeEventListener('beforeinstallprompt', on);
  }, [givenInstall]);
  const canPrompt = given || !!own;
  const onInstall = givenInstall ?? (own ? async () => { await own.prompt(); await own.userChoice; } : undefined);
  const [platform, setPlatform] = useState<InstallPlatform>('desktop');
  const [ready, setReady] = useState(false);
  const [video, setVideo] = useState(false);
  const [step, setStep] = useState(0);
  const [copied, setCopied] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const p = forcePlatform ?? detectInstallPlatform();
    setPlatform(p);
    // The video is no longer part of the flow — only the preview can still open on it.
    setVideo(forceVideo === true && p !== 'desktop' && p !== 'standalone');
    // Shown once: from here on the app itself only offers the small strip (InstallPrompt).
    if (!forcePlatform && p !== 'desktop' && p !== 'standalone') {
      try { localStorage.setItem(INSTALL_GUIDE_SEEN_KEY, '1'); } catch { /* private mode */ }
    }
    setReady(true);
  }, [forcePlatform, forceVideo]);

  const steps = useMemo(() => stepsFor(platform, canPrompt), [platform, canPrompt]);
  const browser = platform.startsWith('android') ? 'Chrome' : 'Safari';
  const endVideo = useCallback(() => {
    try { localStorage.setItem(VIDEO_SEEN_KEY, '1'); } catch { /* ignore */ }
    setVideo(false);
  }, []);
  useEffect(() => { topRef.current?.scrollTo?.({ top: 0 }); }, [step]);

  if (!ready || platform === 'standalone') return null;
  // /preview/install?video=1 only. iPhone: the real recording; elsewhere the drawn one.
  if (video && steps.length && platform.startsWith('ios-safari')) return <RealVideo onDone={endVideo} />;
  if (video && steps.length) return <InstallVideo steps={steps} browser={browser} onDone={endVideo} />;

  const desktop = platform === 'desktop';
  const s = steps[step];
  const last = step === steps.length - 1;
  const help = helpLink(platform, step, memberName);
  const isSafari = platform === 'ios-safari' || platform === 'ios-safari-26' || platform === 'ios-safari-compact';
  const inApp = platform === 'ios-inapp' || platform === 'android-inapp';
  const device = DEVICE_LABEL[platform].replace(' · ', ', ');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch { /* the steps above are still the way */ }
  };

  const title = desktop ? 'את האפליקציה מתקינים בטלפון' : inApp ? 'רגע לפני: פותחים בדפדפן' : 'מוסיפים את מדרגות למסך הבית';
  const subtitle = !desktop && steps.length > 1 ? `צעד ${step + 1} מתוך ${steps.length} · ${device}` : device;

  // The header's top row: back (from step 2 on) at the start, "not now" at the end —
  // both 44px, "not now" a white pill in the quiet ink so it reads on the sunset.
  const top = (
    <div className="-mx-1 mb-1 flex min-h-[44px] items-center justify-between">
      {step > 0 && !desktop ? (
        <button type="button" onClick={() => setStep(step - 1)} className="min-h-[44px] px-2 text-[14px] font-bold text-white">→ חזרה</button>
      ) : <span />}
      {!blocking && <button type="button" onClick={onLater} className="min-h-[44px] rounded-full bg-white px-4 text-[14px] font-extrabold" style={{ color: JOURNEY.soft }}>לא עכשיו</button>}
    </div>
  );

  const pointer = s?.point && !desktop ? (
    <div className={`ig-point ${s.point}`} aria-hidden>
      {s.point === 'top-right' ? (<><span>↑</span>הכפתור כאן למעלה</>) : (<>הכפתור כאן למטה<span>↓</span></>)}
    </div>
  ) : null;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col" style={{ background: JOURNEY.page }} role="dialog" aria-modal="true" aria-labelledby="install-guide-title" dir="rtl" data-testid="install-guide">
      <div className="mx-auto flex h-[100dvh] w-full max-w-md flex-col">
        <JourneyHero compact top={top} title={<span id="install-guide-title">{title}</span>} subtitle={subtitle} />

        <div ref={topRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pt-3" style={{ color: JOURNEY.body }}>
          {desktop ? (
            <div className="flex flex-col items-center gap-3 pt-2 text-center">
              <p className="max-w-[320px] text-[15px] leading-relaxed" style={{ color: JOURNEY.soft }}>פותחים את המצלמה של הטלפון, מכוונים לקוד ולוחצים על הקישור שקופץ.</p>
              <Qr url={typeof window === 'undefined' ? '' : window.location.href} />
              <p className="max-w-[300px] text-[13px] leading-relaxed" style={{ color: JOURNEY.soft }}>או: פותחים בטלפון את המייל או ההודעה עם הקישור, ולוחצים שם.</p>
            </div>
          ) : (
            <>
              {s.point === 'top-right' && pointer}
              {/* The picture gets whatever height is left, never more than about half the screen. */}
              <div className="ig-stage relative min-h-[170px] flex-1" style={{ maxHeight: '52dvh' }}>
                <div className="absolute inset-0 flex justify-center py-1">
                  {s.shot ? <StepShot shot={s.shot} /> : <InstallScene scene={s.scene} browser={browser} />}
                </div>
              </div>
              <div className="text-center">
                <h2 className="text-[18px] font-black leading-snug" style={{ color: JOURNEY.ink }}>{ltrParens(s.title)}</h2>
                <p className="mx-auto mt-1 max-w-[340px] text-[14px] leading-snug" style={{ color: JOURNEY.soft }}>{ltrParens(s.body)}</p>
              </div>
            </>
          )}

          {(help || (onNever && !blocking) || (blocking && onEscape)) && (
            <div className="flex flex-wrap items-center justify-center gap-x-4">
              {help && (
                <a href={help} target="_blank" rel="noopener noreferrer" className="flex min-h-[44px] items-center gap-1.5 text-[14px] font-extrabold text-[#128C4B]">
                  💬 נתקעתם? כותבים לנו בוואטסאפ
                </a>
              )}
              {onNever && !blocking && (
                <button type="button" onClick={onNever} className="min-h-[44px] text-[13px] underline underline-offset-2" style={{ color: JOURNEY.soft }}>לא להציע שוב</button>
              )}
              {blocking && onEscape && (
                <button type="button" onClick={onEscape} className="min-h-[44px] text-[13px] underline underline-offset-2" style={{ color: JOURNEY.soft }}>
                  לא מצליחים להתקין? כניסה בדפדפן
                </button>
              )}
            </div>
          )}
        </div>

        {!desktop && (
          // The bottom bar: always on screen, never scrolled away.
          <div className="flex shrink-0 flex-col gap-1 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-2.5" data-testid="install-guide-bar">
            {platform === 'android' && canPrompt && step === 0 ? (
              <PrimaryButton onClick={async () => { await onInstall?.(); setStep(1); }}>התקנת האפליקציה</PrimaryButton>
            ) : inApp ? (
              <PrimaryButton onClick={copy}>{copied ? '✓ הקישור הועתק. מדביקים אותו בדפדפן' : 'העתקת הקישור'}</PrimaryButton>
            ) : last && blocking ? (
              <p className="rounded-[20px] px-4 py-3 text-center text-[15px] font-bold leading-relaxed" style={{ background: JOURNEY.tagBg, color: JOURNEY.ink }}>
                עכשיו סוגרים את הדפדפן, פותחים את האייקון של מדרגות במסך הבית, ונכנסים משם 🏠
              </p>
            ) : last ? (
              <PrimaryButton onClick={onDone ?? onLater}>סיימתי</PrimaryButton>
            ) : (
              <PrimaryButton onClick={() => setStep(step + 1)}>עשיתי, הבא</PrimaryButton>
            )}
            {isSafari && (
              <SecondaryButton onClick={() => { setPlatform(otherSafari(platform)); setStep(0); }}>אצלי זה נראה אחרת</SecondaryButton>
            )}
            {s.point !== 'top-right' && pointer}
          </div>
        )}
      </div>
    </div>
  );
}
