'use client';

// The required setup a new member finishes before the app opens (Ofer 2026-10-20,
// ~/.cache/madregot/join-flow-mockup.html section 5): install, a watch (or "I have
// none"), notifications, and only the details still missing — birth date, height, the
// five sizes. Weight and the photo stay optional. Whoever stopped half-way is brought
// back to the step that is left. The rule is lib/setup/gate.ts, the facts /api/setup.
//
// Drawn in the app's own iOS look (the run-together screens), not the joining journey's
// sunset: light page, white cards, one blue — and real things in it: the app icon, the
// Garmin and Strava marks, the iPhone's own share sheet.
//
// Steps aside on the profile screen, where the watch is connected, and comes back after.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { mutate } from 'swr';
import { Bell, CalendarClock, Check, ChevronLeft, MapPin, Watch } from 'lucide-react';
import { apiHeaders, useApi } from '@/lib/api';
import { isIosDevice, isStandalone, subscribeToPush } from '@/lib/pwa';
import { useIsComputer } from '@/lib/install/use-computer';
import { CLOTHING_SIZES, SOCK_SIZES } from '@/lib/kit-sizes';
import { EU_SHOE_SIZES } from '@/lib/shoe-catalog';
import { remainingSteps, SETUP_ORDER, type SetupStep } from '@/lib/setup/gate';
import { useInstallStep } from '@/components/onboarding/InstallStepProvider';
import { pointManifestAt } from '@/lib/auth/install-key';
import { isViewingPerson } from '@/lib/view-as-person';

type SizeKey = 'shoeSize' | 'shirtSize' | 'pantsSize' | 'tightsSize' | 'socksSize';
interface SetupFacts {
  applicable: boolean;
  preview?: boolean;
  phoneOpened?: boolean;
  garmin?: boolean;
  strava?: boolean;
  noWatch?: boolean;
  push?: boolean;
  birthDate?: string | null;
  heightCm?: number | null;
  weightKg?: number | null;
  sizes?: Record<SizeKey, string | null>;
}

const PREVIEW_KEY = 'mc:setup-preview';
const INSTALL_KEY_STORE = 'mc:install-key';
const KEY = '/api/setup';
const BLUE = '#1525FF';
const INK = '#111218';
const SOFT = '#55565F';
const LINE = '#EFEFF3';
const CARD = 'rounded-[22px] bg-white shadow-[0_1px_2px_rgba(0,0,0,.04),0_8px_20px_-12px_rgba(0,0,0,.14)]';

function firstName(): string {
  try {
    return localStorage.getItem('mc-first-name') || (localStorage.getItem('athlete_name') || '').split(/\s+/)[0] || '';
  } catch { return ''; }
}

/** Strava's official mark — the same paths as the landing page's (src/app/page.tsx). */
function StravaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="m15.387 17.944-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066M10.463 8.392l2.835 5.436h4.173L10.463 0l-7 13.828h4.169" />
    </svg>
  );
}

function Shell({ step, title, sub, badge, children, foot }: { step: number; title: ReactNode; sub?: ReactNode; badge?: ReactNode; children?: ReactNode; foot?: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-[#F2F2F7]" dir="rtl" role="dialog" aria-modal="true" aria-label="הגדרת האפליקציה" data-testid="setup-gate">
      <div className="mx-auto flex min-h-[100dvh] max-w-[480px] flex-col px-[18px] pt-[max(14px,env(safe-area-inset-top))]" style={{ color: INK }}>
        {step > 0 && (
          <>
            <div className="mb-3.5 mt-1.5 flex gap-[5px]" aria-hidden>
              {SETUP_ORDER.map((s, i) => <i key={s} className="h-[5px] flex-1 rounded-full" style={{ background: i < step ? BLUE : '#DCDCE3' }} />)}
            </div>
            <p className="mb-1 text-[13px] font-extrabold" style={{ color: BLUE }}>שלב {step} מתוך 4</p>
          </>
        )}
        {badge}
        {title && <h1 className="mb-2 text-[29px] font-black leading-[1.15] tracking-[-0.6px]">{title}</h1>}
        {sub && <p className="mb-[18px] text-[15.5px] leading-normal" style={{ color: SOFT }}>{sub}</p>}
        {children}
        {foot && (
          <div className="sticky bottom-0 mt-auto flex flex-col gap-1.5 bg-gradient-to-t from-[#F2F2F7] from-70% to-transparent pb-[max(24px,env(safe-area-inset-bottom))] pt-4">{foot}</div>
        )}
      </div>
    </div>
  );
}

function Primary({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="flex h-14 items-center justify-center gap-2 rounded-[18px] text-[17px] font-black transition-colors"
      style={disabled ? { background: '#E3E5FF', color: BLUE } : { background: BLUE, color: '#fff', boxShadow: '0 10px 22px -10px rgba(21,37,255,.7)' }}>
      {children}
    </button>
  );
}
function Quiet({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled} className="h-11 text-[15px] font-extrabold" style={{ color: SOFT }}>{children}</button>;
}

function Benefits({ rows }: { rows: Array<[ReactNode, string]> }) {
  return (
    <div className={`${CARD} px-3.5 py-1.5`}>
      {rows.map(([icon, text], i) => (
        <div key={text} className="flex items-center gap-3 py-2.5 text-[15px] font-bold" style={i ? { borderTop: `1px solid ${LINE}` } : undefined}>
          <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px] bg-[#EEF0FF]" style={{ color: BLUE }}>{icon}</span>
          {text}
        </div>
      ))}
    </div>
  );
}

// ── 1 · welcome + install ───────────────────────────────────────────────────
// The first thing a newly approved member sees. The real install video (recorded on an
// iPhone — share, add to home screen, open the icon, sign in with the emailed code) IS the
// install step: no separate guide after it. A browser tab can't see the install happen, so
// "הוספתי" says where to go next — the icon — and the gate picks up there.
function InstallStep({ onSkip }: { onSkip: () => void }) {
  const install = useInstallStep();
  const prompt = install.offer?.kind === 'prompt' ? install.offer.prompt : null;
  const name = firstName();
  const [ios, setIos] = useState(true);
  const [added, setAdded] = useState(false);
  useEffect(() => setIos(isIosDevice()), []);
  // The icon they are about to add carries this login (api/auth/install-key), so its
  // first open is already signed in. One key per tab, kept across a reload.
  useEffect(() => {
    if (isViewingPerson()) return;
    let cached: string | null = null;
    try { cached = sessionStorage.getItem(INSTALL_KEY_STORE); } catch { /* private mode */ }
    if (cached) { pointManifestAt(cached); return; }
    (async () => {
      const res = await fetch('/api/auth/install-key', { method: 'POST', headers: await apiHeaders() });
      const v = res.ok ? ((await res.json()) as { verifier?: string }).verifier : null;
      if (!v) return;
      try { sessionStorage.setItem(INSTALL_KEY_STORE, v); } catch { /* private mode */ }
      pointManifestAt(v);
    })().catch(() => { /* the icon opens on the ordinary sign-in */ });
  }, []);
  return (
    <Shell step={1} title={`ברוכים הבאים${name ? `, ${name}` : ''}`}
      sub="עוד 4 צעדים קצרים ונכנסים. מתחילים בהתקנה — הכל בסרטון."
      badge={<span className="mb-3 inline-flex items-center gap-1.5 self-start rounded-full bg-[#E3F4EA] px-3 py-1.5 text-[13.5px] font-extrabold text-[#0E7A3C]"><Check className="h-4 w-4" strokeWidth={3} aria-hidden />הבקשה שלך אושרה</span>}
      foot={added ? (
        <div className={`${CARD} flex items-center gap-3 p-3.5`} role="status">
          {/* eslint-disable-next-line @next/next/no-img-element -- the app's own icon, as it sits on the home screen */}
          <img src="/images/icon-192.png" alt="" className="h-12 w-12 shrink-0 rounded-[12px] shadow" />
          <p className="text-[15px] font-bold leading-snug">מעולה. עכשיו סוגרים את הדפדפן ופותחים את <b>מדרגות</b> מהמסך הבית — ושם ממשיכים.</p>
        </div>
      ) : (
        <>
          {prompt
            ? <Primary onClick={() => prompt.prompt()}>התקנה</Primary>
            : <Primary onClick={() => setAdded(true)}>הוספתי למסך הבית</Primary>}
          <Quiet onClick={onSkip}>לא מצליחים להתקין? ממשיכים בדפדפן</Quiet>
        </>
      )}>
      <div className="flex min-h-0 flex-1 justify-center">
        {ios ? (
          <div className="relative h-[min(460px,calc(100dvh-360px))] min-h-[260px] overflow-hidden rounded-[24px] bg-[#1B23A8] shadow-[0_1px_2px_rgba(0,0,0,.06),0_18px_36px_-18px_rgba(0,0,0,.35)]" style={{ aspectRatio: '540 / 960' }} data-testid="install-video">
            <video src="/videos/install-iphone.mp4" poster="/videos/install-iphone-poster.jpg" autoPlay muted loop playsInline className="block h-full w-full object-cover" />
          </div>
        ) : (
          <div className={`${CARD} flex w-full items-center gap-3.5 self-start p-4`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- the app's own icon */}
            <img src="/images/icon-192.png" alt="" className="h-16 w-16 rounded-[16px] shadow-md" />
            <div><b className="block text-[17px]">מדרגות</b><span className="text-[14px]" style={{ color: SOFT }}>התקנה בלחיצה אחת, בלי חנות אפליקציות</span></div>
          </div>
        )}
      </div>
    </Shell>
  );
}

// ── 2 · Garmin ──────────────────────────────────────────────────────────────
// Members sign in with Strava, so by now it is connected; the step is Garmin, the one
// that can push the coach's workouts to the watch. Strava is shown as done (or as a
// connect row for the few who came in by email code).
function WatchStep({ strava, onNoWatch, busy }: { strava: boolean; onNoWatch: () => void; busy: boolean }) {
  const router = useRouter();
  const connectGarmin = () => router.push('/dashboard/profile?connectGarmin=1');
  return (
    <Shell step={2} title="מחברים את Garmin"
      sub={strava ? 'Strava כבר מחובר מההרשמה. עכשיו Garmin — כדי שנוכל לדחוף לכם אימונים לשעון.' : 'כדי שנוכל לדחוף לכם אימונים לשעון.'}
      foot={<>
        <Primary onClick={connectGarmin}>חיבור Garmin</Primary>
        <Quiet onClick={onNoWatch} disabled={busy}>אין לי Garmin — ממשיכים</Quiet>
      </>}>
      {/* eslint-disable-next-line @next/next/no-img-element -- the club's own photo */}
      <img src="/images/runners-group.jpg" alt="" className="mb-3 h-[120px] w-full rounded-[22px] object-cover" style={{ objectPosition: '50% 84%' }} />
      <div className={`${CARD} px-4 [&>*+*]:border-t [&>*+*]:border-[#EFEFF3]`}>
        <div className="flex min-h-[64px] items-center gap-3">
          <span className="flex-1"><span className="flex items-center gap-1.5 text-[19px] font-black tracking-[-0.3px]" style={{ color: '#FC4C02' }}><StravaMark className="h-[22px] w-[22px]" />STRAVA</span></span>
          {strava ? (
            <span className="flex items-center gap-1 rounded-full bg-[#E3F4EA] px-2.5 py-1 text-[13px] font-extrabold text-[#0E7A3C]"><Check className="h-[15px] w-[15px]" strokeWidth={3} aria-hidden />מחובר</span>
          ) : (
            <button type="button" onClick={() => router.push('/dashboard/profile?tab=datasource')} className="flex min-h-[44px] items-center gap-0.5 text-[14px] font-extrabold" style={{ color: BLUE }}>חיבור<ChevronLeft className="h-4 w-4" aria-hidden /></button>
          )}
        </div>
        <button type="button" onClick={connectGarmin} className="flex min-h-[74px] w-full items-center gap-3 text-start">
          <span className="flex-1">
            {/* eslint-disable-next-line @next/next/no-img-element -- the official Garmin logo (public/images/brands) */}
            <img src="/images/brands/garmin.svg" alt="Garmin" className="h-[22px] w-auto" />
            <span className="mt-1.5 block text-[13.5px] font-semibold" style={{ color: '#6B6C76' }}>מומלץ — כך נוכל לדחוף לכם אימונים לשעון</span>
          </span>
          <span className="flex items-center gap-0.5 text-[14px] font-extrabold" style={{ color: BLUE }}>חיבור<ChevronLeft className="h-4 w-4" aria-hidden /></span>
        </button>
      </div>
      <div className="mt-3 flex items-start gap-3 rounded-[18px] border border-[#D5DAFF] bg-[#EEF0FF] p-3.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white" style={{ color: BLUE }}><Watch className="h-[18px] w-[18px]" aria-hidden /></span>
        <p className="text-[14.5px] leading-snug" style={{ color: INK }}><b className="block text-[15.5px] font-black" style={{ color: BLUE }}>הכי שווה: שניהם מחוברים</b>Strava ו-Garmin יחד — ככה אנחנו מושכים כמה שיותר נתונים, והאימונים נשלחים לשעון.</p>
      </div>
    </Shell>
  );
}

// ── 3 · notifications ───────────────────────────────────────────────────────
function PushStep({ onEnable, busy, error }: { onEnable: () => void; busy: boolean; error: string | null }) {
  const now = new Date();
  const time = now.toLocaleTimeString('he-IL', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Jerusalem' });
  const day = now.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Jerusalem' });
  const notes = [
    { when: 'עכשיו', text: 'האימון בעוד 20 דק׳ · נפגשים בנקודה הקבועה' },
    { when: 'אתמול', text: 'המאמן ענה על האימון שלך' },
  ];
  return (
    <Shell step={3} title="מפעילים התראות" sub="רק מה שחשוב: האימון, שינויים, ותשובה מהמאמן."
      foot={<>
        {error && <p role="alert" className="mb-1 text-center text-[14px] font-bold text-[#AD3838]">{error}</p>}
        <Primary onClick={onEnable} disabled={busy}><Bell className="h-[19px] w-[19px]" strokeWidth={2.4} />{busy ? 'רגע…' : 'הפעלת התראות'}</Primary>
        <p className="py-2 text-center text-[13.5px] font-bold" style={{ color: SOFT }}>אפשר לכבות כל סוג בהגדרות</p>
      </>}>
      <div className="relative mb-4 overflow-hidden rounded-[26px] px-3 pb-3.5 pt-5 text-white">
        {/* eslint-disable-next-line @next/next/no-img-element -- the club's own photo as the lock-screen wallpaper */}
        <img src="/images/hero-running.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-black/10 to-black/30" />
        <div className="relative">
          <div className="text-center text-[52px] font-light leading-none tracking-[-1px]" dir="ltr">{time}</div>
          <div className="mb-4 mt-1 text-center text-[13.5px] font-bold opacity-90">{day}</div>
          {notes.map((n) => (
            <div key={n.when} className="mt-2 flex gap-2.5 rounded-[18px] bg-white/80 px-3 py-2.5 backdrop-blur-md" style={{ color: INK }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- the app's own icon */}
              <img src="/images/icon-192.png" alt="" className="h-[34px] w-[34px] shrink-0 rounded-[9px]" />
              <div className="min-w-0 flex-1">
                <b className="flex justify-between text-[13.5px]">מדרגות<em className="text-[12px] font-semibold not-italic text-[#6B6C76]">{n.when}</em></b>
                <p className="mt-0.5 text-[13px] leading-snug text-[#2A2B33]">{n.text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
      <Benefits rows={[
        [<CalendarClock key="c" className="h-[18px] w-[18px]" />, 'תזכורת לאימון בבוקר'],
        [<MapPin key="p" className="h-[18px] w-[18px]" />, 'שינוי שעה או מקום'],
      ]} />
    </Shell>
  );
}

// ── 4 · details ─────────────────────────────────────────────────────────────
const SIZE_LABEL: Record<SizeKey, string> = { shoeSize: 'נעליים', shirtSize: 'חולצה', pantsSize: 'מכנסיים קצרים', tightsSize: 'טייץ', socksSize: 'גרביים' };
const HEIGHTS = Array.from({ length: 81 }, (_, i) => 140 + i);
const WEIGHTS = Array.from({ length: 91 }, (_, i) => 40 + i);

function Dot() { return <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#FF5315]" aria-label="חסר" />; }

/** A settings-style row whose value opens the phone's own picker (date wheel, list wheel). */
function PickRow({ label, value, missing, optional, children }: { label: string; value: string | null; missing: boolean; optional?: boolean; children: ReactNode }) {
  return (
    <label className="relative flex min-h-[52px] items-center gap-2.5 text-[16px] font-bold">
      {missing && <Dot />}
      {label}
      <span className="ms-auto flex items-center gap-1 font-extrabold" style={{ color: value ? INK : optional ? '#6B6C76' : BLUE }}>
        {value ? <bdi dir="ltr">{value}</bdi> : optional ? 'לא חובה' : 'בחירה'}
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </span>
      {children}
    </label>
  );
}
const overlay = 'absolute inset-0 h-full w-full cursor-pointer opacity-0';

function DetailsStep({ facts, onSaved }: { facts: SetupFacts; onSaved: () => void }) {
  const start = facts.sizes || { shoeSize: null, shirtSize: null, pantsSize: null, tightsSize: null, socksSize: null };
  // Every field, not only the missing ones: what was filled at sign-up is shown with its
  // value so a wrong one can be put right here (Ofer 2026-10-20). Missing ones carry the dot.
  const ask = { birthDate: true, height: true, weight: true, sizes: Object.keys(start) as SizeKey[] };
  const [birthDate, setBirthDate] = useState(facts.birthDate || '');
  const [height, setHeight] = useState(facts.heightCm ? String(facts.heightCm) : '');
  const [weight, setWeight] = useState(facts.weightKg ? String(facts.weightKg) : '');
  const [sizes, setSizes] = useState(start);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const left = (birthDate ? 0 : 1) + (height ? 0 : 1) + Object.values(sizes).filter((v) => !v).length;

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const res = await fetch('/api/athletes/me', {
        method: 'PUT', headers: await apiHeaders(true),
        body: JSON.stringify({ id: localStorage.getItem('athlete_id'), birthDate, heightCm: Number(height), ...(weight ? { weightKg: Number(weight) } : {}), ...sizes }),
      });
      if (!res.ok) throw new Error(String(res.status));
      onSaved();
    } catch {
      setError('השמירה לא הצליחה. נסו שוב בעוד רגע.');
    } finally { setSaving(false); }
  };

  const shown = birthDate ? birthDate.split('-').reverse().join('.') : null;
  const rows = [
    ask.birthDate && (
      <PickRow key="b" label="תאריך לידה" value={shown} missing={!birthDate}>
        <input type="date" aria-label="תאריך לידה" className={overlay} value={birthDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setBirthDate(e.target.value)} />
      </PickRow>
    ),
    ask.height && (
      <PickRow key="h" label="גובה" value={height ? `${height} ס״מ` : null} missing={!height}>
        <select aria-label="גובה" className={overlay} value={height} onChange={(e) => setHeight(e.target.value)}>
          <option value="">בחירה</option>{HEIGHTS.map((h) => <option key={h} value={h}>{h} ס״מ</option>)}
        </select>
      </PickRow>
    ),
    ask.weight && (
      <PickRow key="w" label="משקל" value={weight ? `${weight} ק״ג` : null} missing={false} optional>
        <select aria-label="משקל" className={overlay} value={weight} onChange={(e) => setWeight(e.target.value)}>
          <option value="">לא עכשיו</option>{WEIGHTS.map((w) => <option key={w} value={w}>{w} ק״ג</option>)}
        </select>
      </PickRow>
    ),
  ].filter(Boolean);

  return (
    <Shell step={4} title={left > 0 ? `עוד ${left} ${left === 1 ? 'פרט' : 'פרטים'}` : 'הכל מולא'} sub="בודקים שהכל נכון. מה שמילאת בהרשמה כבר כאן — אפשר לתקן כל שורה."
      foot={<>
        {error && <p role="alert" className="mb-1 text-center text-[14px] font-bold text-[#AD3838]">{error}</p>}
        <Primary onClick={save} disabled={left > 0 || saving}>{saving ? 'שומרים…' : left > 0 ? `${left === 1 ? 'נשאר 1' : `נשארו ${left}`} · שמירה` : 'שמירה'}</Primary>
      </>}>
      {rows.length > 0 && (
        <div className={`${CARD} mb-3.5 px-3.5 [&>*+*]:border-t [&>*+*]:border-[#EFEFF3]`}>{rows}</div>
      )}
      {ask.sizes.length > 0 && (
        <>
          <p className="mb-[7px] ms-1.5 text-[13px] font-extrabold" style={{ color: '#6B6C76' }}>מידות ביגוד</p>
          <div className={`${CARD} mb-4 [&>*+*]:border-t [&>*+*]:border-[#EFEFF3]`}>
            {ask.sizes.map((k) => (
              <div key={k} className="px-3.5 pb-3.5 pt-3">
                <div className="mb-2 flex items-center justify-between text-[15px] font-extrabold">
                  {SIZE_LABEL[k]}
                  {sizes[k] ? <Check className="h-4 w-4 text-[#0E7A3C]" strokeWidth={3} aria-label="נבחר" /> : <span className="text-[12.5px] text-[#C2410C]">חסר</span>}
                </div>
                {k === 'shoeSize' ? (
                  <ShoeChips value={sizes.shoeSize} onPick={(v) => setSizes({ ...sizes, shoeSize: v })} />
                ) : (
                  <div className="flex rounded-[12px] bg-[#EEEEF2] p-[3px]" dir="ltr" role="radiogroup" aria-label={SIZE_LABEL[k]}>
                    {(k === 'socksSize' ? SOCK_SIZES : CLOTHING_SIZES).map((o) => (
                      <button key={o} type="button" role="radio" aria-checked={sizes[k] === o} onClick={() => setSizes({ ...sizes, [k]: o })}
                        className="min-h-[44px] flex-1 rounded-[9px] text-[14px] font-extrabold"
                        style={sizes[k] === o ? { background: '#fff', color: BLUE, boxShadow: '0 1px 3px rgba(0,0,0,.14)' } : { color: '#45464F' }}>
                        {o}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </Shell>
  );
}

function ShoeChips({ value, onPick }: { value: string | null; onPick: (v: string) => void }) {
  // Opens on the common sizes (the row scrolls both ways for the rest).
  useEffect(() => {
    document.getElementById(`shoe-${value || '42'}`)?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [value]);
  return (
    <div className="-mx-3.5 flex gap-1.5 overflow-x-auto px-3.5 pb-1 [scrollbar-width:none]" dir="ltr" role="radiogroup" aria-label="מידת נעליים">
      {EU_SHOE_SIZES.map((o) => (
        <button key={o} id={`shoe-${o}`} type="button" role="radio" aria-checked={value === o} onClick={() => onPick(o)}
          className="h-11 min-w-[48px] shrink-0 rounded-[12px] px-2 text-[14px] font-extrabold"
          style={value === o ? { background: BLUE, color: '#fff' } : { background: '#EEEEF2', color: '#45464F' }}>
          {o}
        </button>
      ))}
    </div>
  );
}

// ── done ────────────────────────────────────────────────────────────────────
function DoneStep({ garmin, onClose }: { garmin: boolean; onClose: () => void }) {
  const name = firstName();
  const items: Array<[string, string?]> = [
    ['האפליקציה במסך הבית'],
    garmin ? ['Strava ו-Garmin מחוברים', 'הריצה הבאה תיכנס לבד'] : ['Strava מחובר', 'Garmin — אפשר לחבר בפרופיל'],
    ['התראות פועלות'],
    ['הפרטים מלאים'],
  ];
  return (
    <Shell step={0} title={null} foot={<Primary onClick={onClose}>לאפליקציה</Primary>}>
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <span className="mb-[18px] flex h-24 w-24 items-center justify-center rounded-full bg-[#E3F4EA] text-[#0E7A3C]"><Check className="h-12 w-12" strokeWidth={3} /></span>
        <h1 className="mb-1 text-[29px] font-black tracking-[-0.6px]">הכל מוכן{name ? `, ${name}` : ''}</h1>
        <p className="text-[15.5px]" style={{ color: SOFT }}>נתראה באימון הבא</p>
        <div className={`${CARD} mt-[18px] w-full px-3.5 py-1 text-start`}>
          {items.map(([t, s], i) => (
            <div key={t} className="flex items-center gap-2.5 py-3 text-[15.5px] font-extrabold" style={i ? { borderTop: `1px solid ${LINE}` } : undefined}>
              <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-[#0E7A3C] text-white"><Check className="h-[15px] w-[15px]" strokeWidth={3.2} /></span>
              {t}{s && <small className="ms-auto text-[13px] font-bold" style={{ color: '#6B6C76' }}>{s}</small>}
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}

export function SetupGate({ onActive }: { onActive?: (on: boolean) => void }) {
  const pathname = usePathname();
  const computer = useIsComputer();
  // ?setup=1 turns the super user's preview on for this tab (the server refuses anyone else).
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get('setup');
      if (q === '1') sessionStorage.setItem(PREVIEW_KEY, '1');
      if (q === '0') sessionStorage.removeItem(PREVIEW_KEY);
      setPreview(sessionStorage.getItem(PREVIEW_KEY) === '1');
    } catch { /* private mode */ }
  }, []);
  const key = preview ? `${KEY}?preview=1` : KEY;
  const { data } = useApi<SetupFacts>(key, { revalidateOnFocus: true });
  const [standalone, setStandalone] = useState(false);
  const [iosTab, setIosTab] = useState(false);
  useEffect(() => { setStandalone(isStandalone()); setIosTab(isIosDevice()); }, []);
  // "Can't install" holds for this visit only: an install the app can't see (an Android
  // Chrome tab) must never lock somebody out.
  const [installLater, setInstallLater] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  // Somebody who walked at least one step sees the closing screen once it is all done.
  const [walked, setWalked] = useState(false);
  const [closed, setClosed] = useState(false);

  const steps = useMemo(() => {
    if (!data?.applicable) return [] as SetupStep[];
    return remainingSteps({
      phone: !computer,
      // Only the installed app itself counts: phone_app_opened_at is stamped by any phone
      // visit, a Safari tab included, so it would skip the install step in Safari.
      installed: standalone || installLater,
      garmin: !!data.garmin, strava: !!data.strava, noWatch: !!data.noWatch,
      // An iPhone's Safari tab cannot be asked for notifications (only the installed app
      // can): somebody who chose "continue in the browser" is not stuck on a step that fails.
      push: !!data.push || (iosTab && !standalone),
      birthDate: data.birthDate ?? null, heightCm: data.heightCm ?? null, sizes: Object.values(data.sizes || {}),
    });
  }, [data, computer, standalone, installLater, iosTab]);
  useEffect(() => { if (steps.length) setWalked(true); }, [steps.length]);

  const done = steps.length === 0 && walked && !closed;
  const active = (steps.length > 0 || done) && !pathname.startsWith('/dashboard/profile');
  useEffect(() => { onActive?.(active); }, [active, onActive]);
  if (!active) return null;
  const refresh = () => mutate(key);
  if (done) return <DoneStep garmin={!!data?.garmin} onClose={() => setClosed(true)} />;

  const at = steps[0];
  if (at === 'install') return <InstallStep onSkip={() => setInstallLater(true)} />;
  if (at === 'watch') {
    return <WatchStep strava={!!data?.strava} busy={busy} onNoWatch={async () => {
      setBusy(true);
      try {
        await fetch(KEY, { method: 'PATCH', headers: await apiHeaders(true), body: JSON.stringify({ noWatch: true }) });
        await refresh();
      } finally { setBusy(false); }
    }} />;
  }
  if (at === 'push') {
    return <PushStep busy={busy} error={pushError} onEnable={async () => {
      setBusy(true); setPushError(null);
      const r = await subscribeToPush(localStorage.getItem('athlete_id') || '');
      setBusy(false);
      if (r.ok) await refresh();
      else setPushError(r.error === 'permission_denied'
        ? 'ההתראות חסומות. הגדרות ← מדרגות ← התראות, מפעילים וחוזרים.'
        : 'זה לא הצליח הפעם. נסו שוב בעוד דקה.');
    }} />;
  }
  return data ? <DetailsStep facts={data} onSaved={refresh} /> : null;
}
