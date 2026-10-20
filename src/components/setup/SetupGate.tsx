'use client';

// The required setup a new member finishes before the app opens (Ofer 2026-10-20,
// ~/.cache/madregot/join-flow-mockup.html section 5): install, a watch (or "I have
// none"), notifications, and only the details still missing — birth date, height, the
// five sizes. Weight and the photo stay optional. Whoever stopped half-way is brought
// back to the step that is left. The rule is lib/setup/gate.ts, the facts /api/setup.
//
// Steps aside on the profile screen, where the watch is connected, and comes back after.

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { mutate } from 'swr';
import { Bell, Smartphone, Watch } from 'lucide-react';
import { apiHeaders, useApi } from '@/lib/api';
import { isStandalone, subscribeToPush } from '@/lib/pwa';
import { useIsComputer } from '@/lib/install/use-computer';
import { CLOTHING_SIZES, SOCK_SIZES } from '@/lib/kit-sizes';
import { EU_SHOE_SIZES } from '@/lib/shoe-catalog';
import { remainingSteps, missingDetails, SETUP_ORDER, type SetupStep } from '@/lib/setup/gate';
import { InstallGuide } from '@/components/install/InstallGuide';
import { useInstallStep } from '@/components/onboarding/InstallStepProvider';
import { JOURNEY, JourneyCard, JourneyHero, JourneyScreen, PrimaryButton, SecondaryButton } from '@/components/onboarding/journey-ui';

interface SetupFacts {
  applicable: boolean;
  preview?: boolean;
  phoneOpened?: boolean;
  connected?: boolean;
  noWatch?: boolean;
  push?: boolean;
  birthDate?: string | null;
  heightCm?: number | null;
  weightKg?: number | null;
  sizes?: Record<'shoeSize' | 'shirtSize' | 'pantsSize' | 'tightsSize' | 'socksSize', string | null>;
}

const PREVIEW_KEY = 'mc:setup-preview';
const KEY = '/api/setup';
const LABEL: Record<SetupStep, string> = { install: 'התקנה', watch: 'שעון', push: 'התראות', details: 'פרטים' };

function StepBar({ at, done }: { at: SetupStep; done: Set<SetupStep> }) {
  return (
    <div className="flex gap-1.5" aria-label="שלבי ההגדרה">
      {SETUP_ORDER.map((s) => {
        const on = s === at;
        const ok = done.has(s);
        return (
          <span key={s} className="flex-1 rounded-full py-1.5 text-center text-[12px] font-extrabold"
            style={{ background: on ? JOURNEY.dusk : ok ? '#E3F4EA' : '#fff', color: on ? '#fff' : ok ? '#0E7A3C' : JOURNEY.muted, border: `1px solid ${on ? JOURNEY.dusk : JOURNEY.line}` }}
            aria-current={on ? 'step' : undefined}>
            {LABEL[s]}{ok ? ' ✓' : ''}
          </span>
        );
      })}
    </div>
  );
}

function Pills({ label, value, options, onPick }: { label: string; value: string | null; options: readonly string[]; onPick: (v: string) => void }) {
  return (
    <div>
      <p className="mb-1.5 text-[14px] font-extrabold" style={{ color: JOURNEY.ink }}>{label}</p>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }} role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o} type="button" role="radio" aria-checked={value === o} onClick={() => onPick(o)}
            className="min-h-[44px] rounded-[14px] px-1 text-[15px] font-bold"
            style={{ background: value === o ? JOURNEY.dusk : '#fff', color: value === o ? '#fff' : JOURNEY.body, border: `1.5px solid ${value === o ? JOURNEY.dusk : JOURNEY.line}` }}>
            <bdi dir="ltr">{o}</bdi>
          </button>
        ))}
      </div>
    </div>
  );
}

function Details({ facts, onSaved }: { facts: SetupFacts; onSaved: () => void }) {
  const need = missingDetails({ birthDate: facts.birthDate ?? null, heightCm: facts.heightCm ?? null, sizes: Object.values(facts.sizes || {}) });
  const s = facts.sizes || { shoeSize: null, shirtSize: null, pantsSize: null, tightsSize: null, socksSize: null };
  const [birthDate, setBirthDate] = useState(facts.birthDate || '');
  const [height, setHeight] = useState(facts.heightCm ? String(facts.heightCm) : '');
  const [weight, setWeight] = useState(facts.weightKg ? String(facts.weightKg) : '');
  const [sizes, setSizes] = useState(s);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Asked once: a field shown at the start stays on screen after it is filled.
  const [ask] = useState(() => ({
    birthDate: need.birthDate, height: need.height,
    sizes: (Object.keys(s) as Array<keyof typeof s>).filter((k) => !s[k]),
    weight: !facts.weightKg,
  }));
  const h = Number(height);
  const ready = !!birthDate && h >= 100 && h <= 250 && Object.values(sizes).every(Boolean);

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const id = localStorage.getItem('athlete_id');
      const w = Number(weight);
      const res = await fetch('/api/athletes/me', {
        method: 'PUT', headers: await apiHeaders(true),
        body: JSON.stringify({ id, birthDate, heightCm: h, ...(weight && w >= 25 && w <= 250 ? { weightKg: w } : {}), ...sizes }),
      });
      if (!res.ok) throw new Error(String(res.status));
      onSaved();
    } catch {
      setError('השמירה לא הצליחה. נסו שוב בעוד רגע.');
    } finally {
      setSaving(false);
    }
  };

  const SIZE_LABEL = { shoeSize: 'נעליים', shirtSize: 'חולצה', pantsSize: 'מכנסיים קצרים', tightsSize: 'טייץ', socksSize: 'גרביים' } as const;
  const field = 'h-[50px] w-full rounded-[14px] border-[1.5px] bg-white px-3 text-[16px]';
  return (
    <div className="flex flex-col gap-4">
      {(ask.birthDate || ask.height) && (
        <JourneyCard className="flex flex-col gap-3 p-4">
          {ask.birthDate && (
            <label className="flex flex-col gap-1.5 text-[14px] font-extrabold" style={{ color: JOURNEY.ink }}>
              תאריך לידה
              <input type="date" value={birthDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setBirthDate(e.target.value)} className={field} style={{ borderColor: JOURNEY.line }} />
            </label>
          )}
          {ask.height && (
            <label className="flex flex-col gap-1.5 text-[14px] font-extrabold" style={{ color: JOURNEY.ink }}>
              גובה (ס״מ)
              <input type="number" inputMode="numeric" min={100} max={250} value={height} onChange={(e) => setHeight(e.target.value)} placeholder="175" className={field} style={{ borderColor: JOURNEY.line }} />
            </label>
          )}
        </JourneyCard>
      )}
      {ask.sizes.length > 0 && (
        <JourneyCard className="flex flex-col gap-4 p-4">
          <p className="text-[13px]" style={{ color: JOURNEY.soft }}>המידות לביגוד של המועדון</p>
          {ask.sizes.map((k) => k === 'shoeSize' ? (
            <label key={k} className="flex flex-col gap-1.5 text-[14px] font-extrabold" style={{ color: JOURNEY.ink }}>
              {SIZE_LABEL[k]}
              <select value={sizes.shoeSize || ''} onChange={(e) => setSizes({ ...sizes, shoeSize: e.target.value || null })} className={field} style={{ borderColor: JOURNEY.line }}>
                <option value="">בחירה</option>
                {EU_SHOE_SIZES.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          ) : (
            <Pills key={k} label={SIZE_LABEL[k]} value={sizes[k]} options={k === 'socksSize' ? SOCK_SIZES : CLOTHING_SIZES} onPick={(v) => setSizes({ ...sizes, [k]: v })} />
          ))}
        </JourneyCard>
      )}
      {ask.weight && (
        <JourneyCard className="p-4">
          <label className="flex flex-col gap-1.5 text-[14px] font-extrabold" style={{ color: JOURNEY.ink }}>
            <span>משקל (ק״ג) <span className="font-semibold" style={{ color: JOURNEY.soft }}>· לא חובה</span></span>
            <input type="number" inputMode="decimal" min={25} max={250} value={weight} onChange={(e) => setWeight(e.target.value)} className={field} style={{ borderColor: JOURNEY.line }} />
          </label>
        </JourneyCard>
      )}
      {error && <p role="alert" className="text-[14px] font-bold" style={{ color: JOURNEY.red }}>{error}</p>}
      <div className="sticky bottom-0 pb-[max(16px,env(safe-area-inset-bottom))] pt-2" style={{ background: `linear-gradient(transparent, ${JOURNEY.page} 28%)` }}>
        <PrimaryButton onClick={save} disabled={!ready || saving}>{saving ? 'שומרים…' : 'סיום — לאפליקציה'}</PrimaryButton>
      </div>
    </div>
  );
}

export function SetupGate({ onActive }: { onActive?: (on: boolean) => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const computer = useIsComputer();
  const install = useInstallStep();
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
  useEffect(() => setStandalone(isStandalone()), []);
  // "Not now" on the install guide holds for this visit only: an install the app can't
  // see (Android Chrome tab) must never lock somebody out.
  const [installLater, setInstallLater] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  const steps = useMemo(() => {
    if (!data?.applicable) return [];
    return remainingSteps({
      phone: !computer,
      installed: standalone || !!data.phoneOpened || installLater,
      connected: !!data.connected, noWatch: !!data.noWatch, push: !!data.push,
      birthDate: data.birthDate ?? null, heightCm: data.heightCm ?? null, sizes: Object.values(data.sizes || {}),
    });
  }, [data, computer, standalone, installLater]);

  const active = steps.length > 0 && !pathname.startsWith('/dashboard/profile');
  useEffect(() => { onActive?.(active); }, [active, onActive]);
  if (!active) return null;
  const at = steps[0];
  const done = new Set(SETUP_ORDER.filter((s) => !steps.includes(s)));
  const refresh = () => mutate(key);

  if (at === 'install') {
    return (
      <div className="fixed inset-0 z-[70] overflow-y-auto" style={{ background: JOURNEY.page }}>
        <InstallGuide
          canPrompt={install.offer?.kind === 'prompt'}
          onInstall={install.offer?.kind === 'prompt' ? async () => { await (install.offer as { prompt: { prompt: () => Promise<void> } }).prompt.prompt(); } : undefined}
          onLater={() => setInstallLater(true)}
          onDone={() => setInstallLater(true)}
          onEscape={() => setInstallLater(true)}
          blocking
        />
      </div>
    );
  }

  const noWatch = async () => {
    setBusy(true);
    try {
      await fetch(KEY, { method: 'PATCH', headers: await apiHeaders(true), body: JSON.stringify({ noWatch: true }) });
      await refresh();
    } finally { setBusy(false); }
  };
  const enablePush = async () => {
    setBusy(true); setPushError(null);
    const id = localStorage.getItem('athlete_id') || '';
    const r = await subscribeToPush(id);
    setBusy(false);
    if (r.ok) await refresh();
    else setPushError(r.error === 'permission_denied'
      ? 'ההתראות חסומות בטלפון. פותחים הגדרות ← מדרגות ← התראות, מפעילים, וחוזרים.'
      : 'זה לא הצליח הפעם. נסו שוב בעוד דקה.');
  };

  const head = {
    watch: { title: 'מחברים את השעון', sub: 'כך כל ריצה נכנסת לבד — לתוכנית, לנוכחות, לשיאים ולסטורי של השבוע.' },
    push: { title: 'מפעילים התראות', sub: 'בלי התראות לא תדעו על האימון של מחר, על שינוי שעה, ועל תשובה מהמאמן.' },
    details: { title: 'עוד כמה פרטים', sub: 'מה שלא מילאתם בהרשמה — המאמן צריך אותם.' },
  }[at];

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto" role="dialog" aria-modal="true" aria-label="הגדרת האפליקציה" data-testid="setup-gate">
      <JourneyScreen
        hero={<JourneyHero compact eyebrow={`הגדרה ${SETUP_ORDER.indexOf(at) + 1}/4`} title={head.title} subtitle={head.sub} />}
        actions={at === 'details' ? undefined : at === 'watch' ? (
          <SecondaryButton onClick={noWatch} disabled={busy}>אין לי שעון — אמשיך בלעדיו</SecondaryButton>
        ) : (
          <PrimaryButton onClick={enablePush} disabled={busy}>{busy ? 'רגע…' : 'הפעלת התראות'}</PrimaryButton>
        )}
      >
        <StepBar at={at} done={done} />
        {at === 'watch' && (
          <div className="flex flex-col gap-2.5">
            {[
              { name: 'Garmin', sub: 'גם האימונים יישלחו לשעון', bg: '#007CC3', href: '/dashboard/profile?connectGarmin=1' },
              { name: 'Strava', sub: 'לכל שעון אחר — Apple, Coros, Polar', bg: '#FC4C02', href: '/dashboard/profile?tab=datasource' },
            ].map((p) => (
              <button key={p.name} type="button" onClick={() => router.push(p.href)}
                className="flex min-h-[64px] items-center gap-3 rounded-[18px] border bg-white px-4 text-start" style={{ borderColor: JOURNEY.line }}>
                <span className="flex h-10 w-10 items-center justify-center rounded-[12px] text-[17px] font-black text-white" style={{ background: p.bg }}>{p.name[0]}</span>
                <span className="flex-1"><b className="block text-[16px]" style={{ color: JOURNEY.ink }}>{p.name}</b><small className="text-[13px]" style={{ color: JOURNEY.soft }}>{p.sub}</small></span>
                <span className="text-[14px] font-extrabold" style={{ color: JOURNEY.dusk }}>חיבור ‹</span>
              </button>
            ))}
            <p className="flex items-center gap-2 text-[13px]" style={{ color: JOURNEY.soft }}><Watch className="h-4 w-4" aria-hidden />&quot;אין לי שעון&quot; נשמר, והמאמן רואה.</p>
          </div>
        )}
        {at === 'push' && (
          <JourneyCard className="flex items-center gap-3 p-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-full" style={{ background: JOURNEY.tagBg, color: JOURNEY.tag }}><Bell className="h-6 w-6" aria-hidden /></span>
            <p className="flex-1 text-[14px]" style={{ color: JOURNEY.soft }}>הטלפון ישאל אם לאשר. אפשר לבחור אחר כך בהגדרות אילו התראות מקבלים.</p>
          </JourneyCard>
        )}
        {at === 'push' && pushError && <p role="alert" className="text-[14px] font-bold" style={{ color: JOURNEY.red }}>{pushError}</p>}
        {at === 'details' && data && <Details facts={data} onSaved={refresh} />}
        {data?.preview && (
          <p className="flex items-center gap-1.5 text-[13px]" style={{ color: JOURNEY.soft }}><Smartphone className="h-3.5 w-3.5" aria-hidden />תצוגה מקדימה · ‎?setup=0 לסגירה</p>
        )}
      </JourneyScreen>
    </div>
  );
}
