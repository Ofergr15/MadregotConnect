'use client';

// The install guide, full screen: a short video that opens by itself (once per
// device, muted — phones refuse to autoplay anything with sound — so it is
// captions and a finger), then the same steps one at a time, each with a drawing
// of what the member sees and an arrow at the edge of the screen toward the
// browser's own button. Built for the member who has never added anything to a
// home screen: one instruction per screen, no jargon, a way out on every screen.
//
// Shared by the in-app install step (InstallPrompt) and the end of /join.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import { detectInstallPlatform, otherSafari, type InstallPlatform } from '@/lib/install/platform';
import { stepsFor, VIDEO_STEP_MS, type InstallStep } from '@/lib/install/steps';
import { InstallScene } from './InstallScene';
import './install.css';

export const VIDEO_SEEN_KEY = 'mc-install-video-seen';
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
  /** /preview/install only: open on the video (true) or skip it (false), whatever this device saw. */
  forceVideo?: boolean;
}

function helpLink(platform: InstallPlatform, step: number, name?: string | null): string | null {
  if (!HELP_WHATSAPP) return null;
  const who = name ? `אני ${name}, ` : '';
  const text = `היי, ${who}נתקעתי בהתקנת האפליקציה של מדרגות (${DEVICE_LABEL[platform]}, צעד ${step + 1}).`;
  return `https://wa.me/${HELP_WHATSAPP}?text=${encodeURIComponent(text)}`;
}

function Qr({ url }: { url: string }) {
  const svg = useMemo(() => {
    const q = qrcode(0, 'M');
    q.addData(url);
    q.make();
    return q.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
  }, [url]);
  return <div className="mx-auto w-[190px] rounded-2xl bg-white p-2 shadow-sm [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** A real screenshot of the step, the control to press ringed. */
function StepShot({ shot }: { shot: NonNullable<InstallStep['shot']> }) {
  const r = shot.ring;
  return (
    <div className="relative mx-auto w-[min(52vw,200px)] overflow-hidden rounded-[26px] border-[5px] border-[#111] shadow-[0_14px_34px_rgba(20,24,60,0.22)]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={shot.src} alt="" className="block w-full" />
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

export function InstallGuide({ canPrompt: given, onInstall: givenInstall, onLater, onNever, memberName, forcePlatform, forceVideo, blocking, onEscape }: InstallGuideProps) {
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
    let seen = false;
    try { seen = localStorage.getItem(VIDEO_SEEN_KEY) === '1'; } catch { /* private mode */ }
    setVideo((forceVideo ?? !seen) && p !== 'desktop' && p !== 'standalone');
    setReady(true);
  }, [forcePlatform, forceVideo]);

  const steps = useMemo(() => stepsFor(platform, canPrompt), [platform, canPrompt]);
  const browser = platform.startsWith('android') ? 'Chrome' : 'Safari';
  const endVideo = useCallback(() => {
    try { localStorage.setItem(VIDEO_SEEN_KEY, '1'); } catch { /* ignore */ }
    setVideo(false);
  }, []);
  useEffect(() => { topRef.current?.scrollIntoView({ block: 'start' }); }, [step]);

  if (!ready || platform === 'standalone') return null;
  // iPhone: the real recording (Ofer's own phone, public/videos). Elsewhere, the
  // drawn walkthrough until there is a recording for that platform too.
  if (video && steps.length && platform.startsWith('ios-safari')) return <RealVideo onDone={endVideo} />;
  if (video && steps.length) return <InstallVideo steps={steps} browser={browser} onDone={endVideo} />;

  const s = steps[step];
  const last = step === steps.length - 1;
  const help = helpLink(platform, step, memberName);
  const isSafari = platform === 'ios-safari' || platform === 'ios-safari-26' || platform === 'ios-safari-compact';
  const inApp = platform === 'ios-inapp' || platform === 'android-inapp';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch { /* the steps above are still the way */ }
  };

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-page" role="dialog" aria-modal="true" aria-labelledby="install-guide-title" dir="rtl" data-testid="install-guide">
      <div ref={topRef} className="mx-auto flex min-h-full max-w-md flex-col px-5 pb-32 pt-[max(18px,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between">
          <span className="rounded-full bg-brand-600/10 px-3 py-1 text-2xs font-extrabold text-brand-600">{DEVICE_LABEL[platform]}</span>
          {!blocking && <button type="button" onClick={onLater} className="min-h-[40px] px-2 text-sm font-bold text-ink-400">לא עכשיו</button>}
        </div>

        {platform === 'desktop' ? (
          <div className="mt-6 flex flex-col items-center gap-3 text-center">
            <h1 id="install-guide-title" className="text-2xl font-black text-ink-700">את האפליקציה מתקינים בטלפון</h1>
            <p className="max-w-[320px] text-sm leading-relaxed text-ink-500">פותחים את המצלמה של הטלפון, מכוונים לקוד ולוחצים על הקישור שקופץ.</p>
            <Qr url={typeof window === 'undefined' ? '' : window.location.href} />
            <p className="max-w-[300px] text-xs leading-relaxed text-ink-400">או: פותחים בטלפון את המייל או ההודעה עם הקישור, ולוחצים שם.</p>
          </div>
        ) : (
          <>
            <h1 id="install-guide-title" className="mt-2 text-center text-[21px] font-black leading-tight text-ink-700">
              {inApp ? 'רגע לפני: פותחים בדפדפן' : 'מוסיפים את מדרגות למסך הבית'}
            </h1>
            {steps.length > 1 && (
              <div className="mt-3 flex justify-center gap-1.5" aria-label={`צעד ${step + 1} מתוך ${steps.length}`}>
                {steps.map((_, i) => (
                  <i key={i} className={`h-1.5 rounded-full transition-all ${i === step ? 'w-6 bg-brand-600' : i < step ? 'w-1.5 bg-brand-600/50' : 'w-1.5 bg-ink-300'}`} />
                ))}
              </div>
            )}

            <div className="mt-4">{s.shot ? <StepShot shot={s.shot} /> : <InstallScene scene={s.scene} browser={browser} />}</div>

            <div className="mt-3 text-center">
              <p className="text-2xs font-black tracking-wide text-brand-600">צעד {step + 1} מתוך {steps.length}</p>
              <h2 className="mt-1 text-lg font-black text-ink-700">{s.title}</h2>
              <p className="mx-auto mt-1 max-w-[320px] text-sm leading-relaxed text-ink-500">{s.body}</p>
            </div>

            <div className="mt-4 flex flex-col gap-2.5">
              {platform === 'android' && canPrompt && step === 0 ? (
                <button type="button" onClick={async () => { await onInstall?.(); setStep(1); }}
                  className="min-h-[52px] rounded-pill bg-brand-600 text-base font-black text-white active:bg-brand-700">
                  התקנת האפליקציה
                </button>
              ) : inApp ? (
                <button type="button" onClick={copy} className="min-h-[52px] rounded-pill bg-brand-600 text-base font-black text-white active:bg-brand-700">
                  {copied ? '✓ הקישור הועתק. מדביקים אותו בדפדפן' : 'העתקת הקישור'}
                </button>
              ) : last && blocking ? (
                <p className="rounded-2xl bg-brand-600/10 px-4 py-3 text-center text-sm font-bold leading-relaxed text-brand-600">
                  עכשיו סוגרים את הדפדפן, פותחים את האייקון של מדרגות במסך הבית, ונכנסים משם 🏠
                </p>
              ) : last ? (
                <button type="button" onClick={onLater} className="min-h-[52px] rounded-pill bg-brand-600 text-base font-black text-white active:bg-brand-700">
                  הבנתי, עובר/ת לאייקון
                </button>
              ) : (
                <button type="button" onClick={() => setStep(step + 1)} className="min-h-[52px] rounded-pill bg-brand-600 text-base font-black text-white active:bg-brand-700">
                  עשיתי את זה · לצעד הבא
                </button>
              )}
              <div className="flex gap-2.5">
                {step > 0 && (
                  <button type="button" onClick={() => setStep(step - 1)} className="min-h-[46px] flex-1 rounded-pill border border-page bg-card text-sm font-bold text-ink-700">
                    → חזרה
                  </button>
                )}
                <button type="button" onClick={() => setVideo(true)} className="min-h-[46px] flex-1 rounded-pill border border-page bg-card text-sm font-bold text-ink-700">
                  ▶ הסרטון שוב
                </button>
              </div>
              {isSafari && (
                <button type="button" onClick={() => { setPlatform(otherSafari(platform)); setStep(0); }}
                  className="mx-auto mt-1 text-xs font-bold text-brand-600 underline underline-offset-2">
                  אצלי זה נראה אחרת
                </button>
              )}
            </div>
          </>
        )}

        {help && (
          <a href={help} target="_blank" rel="noopener noreferrer"
            className="mx-auto mt-6 flex min-h-[44px] items-center gap-2 rounded-full bg-[#25D366] px-4 text-sm font-extrabold text-white shadow-md">
            💬 נתקעת? כתבו לנו בוואטסאפ
          </a>
        )}
        {onNever && !blocking && (
          <button type="button" onClick={onNever} className="mx-auto mt-4 text-2xs text-ink-400 underline">אל תציע לי שוב</button>
        )}
        {blocking && onEscape && (
          <button type="button" onClick={onEscape} className="mx-auto mt-6 text-2xs text-ink-400 underline underline-offset-2">
            לא מצליחים להתקין? כניסה בדפדפן
          </button>
        )}
      </div>

      {s?.point && platform !== 'desktop' && (
        <div className={`ig-point ${s.point}`} aria-hidden>
          {s.point === 'top-right' ? (<><span>↑</span>הכפתור כאן למעלה</>) : (<>הכפתור כאן למטה<span>↓</span></>)}
        </div>
      )}
    </div>
  );
}
