'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Eye, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiHeaders, useApi } from '@/lib/api';
import { BackNav, ConfirmSheet, Sheet, SkeletonList, Switch } from '@/components/ui';
import { israelWallToUtc } from '@/lib/stories/instances';

// "סיפורים" — the stories admin, mockup v3 (~/Desktop/madregot-stories-admin.html).
// Home: one summary line, "השהה הכל", 3 feature cards. Feature: כבוי / רק אני / בדיקה /
// כולם, the settings as a tappable sentence, the shared testers, who gets it next.
// Person sheet: preview + quick actions. Reversible actions get an undo snackbar; only a
// real send to many people asks first. Every write is admin-only, server-side
// (/api/admin/stories*); every read is gated the same way the cron is.

type State = 'off' | 'self' | 'testers' | 'all';
type Feature = 'weekly' | 'birthday' | 'annual';
interface Settings { feature: Feature; state: State; send_push: boolean; feed_post: boolean; generate_at: string; display_days: number; min_runs: number; annual_date: string | null; weekday: number | null }
interface Tester { athleteId: string; name: string | null; status: string | null; viewed: boolean; invitedAt: string | null }
interface Home {
  ready: boolean; ready157?: boolean; paused: boolean; legacyBirthdaySending?: boolean;
  settings: Settings[]; testers: Tester[];
  reach?: Record<Feature, Record<State, number>>; stats?: Record<Feature, { viewed: number; shared: number }>;
}
interface Row { athleteId: string; name: string | null; period: string; bucket: string; status: string; summary: string; publishAt: string; tester: boolean }
interface Upcoming { ready: boolean; ready157?: boolean; today: string; nextAt: string | null; rows: Row[]; total: number; noBirthDate: { athleteId: string; name: string | null }[] }
interface Athlete { id: string; name: string | null; status?: string | null }
interface Person {
  athleteId: string; feature: Feature; period: string; name: string | null;
  effective: { on: boolean; reason: string | null; publishAt: string; until: string; displayDays: number; feedPost: boolean; overridden: string[] };
  settings: { feed_post: boolean; min_runs: number; send_push: boolean };
  numbers: { km: number; runs: number; streak: number | null } | null;
  push: { title: string; body: string } | null; headline: string | null; pushed: boolean;
}
interface Snack { text: string; undo?: () => Promise<void> }

const META: Record<Feature, { emoji: string; title: string; bg: string; when: string; empty: string }> = {
  weekly: { emoji: '📅', title: 'סיכום שבועי', bg: 'bg-[#E8F0FF]', when: 'שבת', empty: 'כל שבת בערב, כל מתאמן מקבל סיכום של השבוע שלו.' },
  birthday: { emoji: '🎂', title: 'יום הולדת', bg: 'bg-[#FFF0EA]', when: 'ביום ההולדת', empty: 'ביום ההולדת, החוגג מקבל את השנה שלו בריצה.' },
  annual: { emoji: '🏁', title: 'סיכום שנתי', bg: 'bg-[#F1E8FF]', when: '31.12', empty: 'ב־31.12 בערב, כל מתאמן מקבל את השנה שלו. פתוח עד סוף ינואר.' },
};
const STATES: Array<[State, string]> = [['off', 'כבוי'], ['self', 'רק אני'], ['testers', 'בדיקה'], ['all', 'כולם']];
const STATE_WORD: Record<State, string> = { off: 'כבוי', self: 'רק אני', testers: 'בבדיקה', all: 'פעיל לכולם' };
const STATUS_WORD: Record<string, string> = {
  ready: '', preview_only: 'רק אני', gate_off: 'כבוי', paused: 'מושהה', not_tester: 'לא בבודקים',
  opted_out: 'ביקש/ה לא לקבל', inactive: 'לא פעיל', skipped: 'דילוג השנה', disabled: 'כבוי לאדם הזה',
};
const BUCKETS: Array<[string, string]> = [['today', 'היום'], ['tomorrow', 'מחר'], ['week', 'השבוע']];
/** A send to more people than this asks first ("לשלוח ל־84 אנשים?"). */
const CONFIRM_OVER = 5;

const days = (n: number) => (n === 1 ? 'יום' : n === 2 ? 'יומיים' : n === 7 ? 'שבוע' : `${n} ימים`);
const hhmm = (iso: string) => new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
const dm = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}`;
const israelDateOf = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date(iso));

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: await apiHeaders(true), body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || 'failed');
  return json;
}

export default function StoriesAdminPage() {
  const router = useRouter();
  const { data, error, mutate } = useApi<Home>('/api/admin/stories');
  const [feature, setFeature] = useState<Feature | null>(null);
  const [snack, setSnack] = useState<Snack | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; text: string; run: () => void } | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((s: Snack) => {
    setSnack(s);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSnack(null), 6000);
  }, []);

  const act = useCallback(async (fn: () => Promise<unknown>, s?: Snack) => {
    setBusy(true);
    try {
      await fn();
      await mutate();
      if (s) toast(s);
    } catch (e) {
      toast({ text: `לא נשמר: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  }, [mutate, toast]);

  const settingsOf = (f: Feature) => data?.settings.find((s) => s.feature === f);

  /** State change with undo; a send to many people confirms first. */
  const setState = (f: Feature, to: State) => {
    const from = settingsOf(f)?.state ?? 'off';
    if (from === to) return;
    const run = () => void act(() => send('/api/admin/stories', 'PUT', { feature: f, state: to }), {
      text: `${META[f].title}: ${STATE_WORD[to]}`,
      undo: () => act(() => send('/api/admin/stories', 'PUT', { feature: f, state: from })),
    });
    const n = data?.reach?.[f]?.[to] ?? 0;
    const s = settingsOf(f);
    if ((to === 'all' || to === 'testers') && n > CONFIRM_OVER && s?.send_push) {
      setConfirm({ title: to === 'all' ? 'להרחיב לכולם?' : 'להפעיל לבודקים?', text: `${META[f].title} יישלח ל־${n} אנשים (${META[f].when}, ${s.generate_at.slice(0, 5)}). אפשר לעצור עד אז.`, run });
    } else run();
  };

  const setPaused = (on: boolean) => void act(() => send('/api/admin/stories', 'PUT', { paused: on }), {
    text: on ? 'כל הסיפורים מושהים' : 'הסיפורים חזרו לפעול',
    undo: () => act(() => send('/api/admin/stories', 'PUT', { paused: !on })),
  });

  const summary = useMemo(() => {
    if (!data?.ready) return '';
    if (data.paused) return 'הכל מושהה · שום דבר לא נשלח';
    const parts = (['weekly', 'birthday', 'annual'] as Feature[]).map((f) => ({ f, s: settingsOf(f) })).filter((x) => x.s && x.s.state !== 'off')
      .map(({ f, s }) => `${META[f].title} ${STATE_WORD[s!.state]}${s!.state === 'testers' ? ` (${data.reach?.[f]?.testers ?? 0})` : ''}`);
    return parts.length ? parts.join(' · ') : 'הכל כבוי. שום סיפור לא נשלח.';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <div className="relative mx-auto max-w-2xl px-4 pb-32 pt-2" dir="rtl">
      {feature ? (
        <FeatureScreen
          feature={feature} home={data} busy={busy} onBack={() => setFeature(null)}
          setState={(s) => setState(feature, s)} act={act} toast={toast} router={router}
        />
      ) : (
        <>
          <BackNav label="תוכן" onBack={() => router.push('/dashboard/content')} />
          <h1 className="mt-2 text-[34px] font-black text-ink-900">סיפורים</h1>
          {!data && !error && <SkeletonList />}
          {error && <ErrorCard onRetry={() => void mutate()} />}
          {data && !data.ready && <p className="mt-4 rounded-card bg-card px-4 py-3 text-sm text-ink-500">מיגרציה 156 עוד לא הודבקה. עד אז כל הסיפורים כבויים לכולם.</p>}
          {data?.ready && (
            <>
              <p className="mt-1 text-[16px] leading-snug text-ink-600">{summary}</p>
              {data.ready157 === false && <p className="mt-2 text-xs text-ink-400">שינויים לאדם אחד יהיו זמינים אחרי מיגרציה 157.</p>}
              <div className={cn('mt-4 flex items-center gap-3 rounded-card border-[1.5px] bg-card px-4 py-3', data.paused ? 'border-accent-red' : 'border-[#FFD9CC]')}>
                <span className="text-2xl" aria-hidden>⏸</span>
                <span className="min-w-0 flex-1">
                  <b className="block text-[17px] font-extrabold text-ink-900">השהה הכל</b>
                  <small className="block text-sm text-ink-500">עוצר מיד כל התראה וכל סיפור</small>
                </span>
                <Switch checked={data.paused} onChange={setPaused} loading={busy} activeColor="bg-accent-red" ariaLabel="השהה הכל" />
              </div>
              {(['weekly', 'birthday', 'annual'] as Feature[]).map((f) => {
                const s = settingsOf(f);
                if (!s) return null;
                const st = data.stats?.[f];
                const line = s.state === 'off' ? `כבוי · ${META[f].when}`
                  : s.state === 'self' ? 'רק אני · לתצוגה, בלי התראות'
                  : s.state === 'testers' ? `${data.reach?.[f]?.testers ?? 0} בודקים${st?.viewed ? ` · ${st.viewed} צפו` : ''}${st?.shared ? ` · ${st.shared} שיתפו` : ''}`
                  : `${data.reach?.[f]?.all ?? 0} אנשים · ${META[f].when} ${s.generate_at.slice(0, 5)}`;
                return (
                  <div key={f} className="mt-2.5 rounded-card bg-card px-4 py-3">
                    <button type="button" onClick={() => setFeature(f)} className="flex min-h-[48px] w-full items-center gap-3 text-start">
                      <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl text-2xl', META[f].bg)} aria-hidden>{META[f].emoji}</span>
                      <span className="min-w-0 flex-1">
                        <b className="block text-[18px] font-extrabold text-ink-900">{META[f].title}</b>
                        <small className="block text-sm text-ink-600">
                          {s.state === 'testers' && <span className="me-1 rounded-md bg-[#FFF4D6] px-1.5 text-xs font-bold text-[#A86A00]">בבדיקה</span>}
                          {line}
                        </small>
                      </span>
                      <ChevronLeft className="h-5 w-5 text-ink-300" />
                    </button>
                    {s.state === 'testers' && (
                      <button type="button" disabled={busy} onClick={() => setState(f, 'all')} className="mt-2 min-h-[44px] w-full rounded-xl bg-[#FFF0EA] text-[15px] font-bold text-brand-600">הרחב לכולם</button>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </>
      )}

      {snack && (
        <div role="status" className="fixed inset-x-4 bottom-24 z-50 mx-auto flex max-w-xl items-center justify-between rounded-2xl bg-[#2C2C2E] px-4 py-3 text-[15px] text-white shadow-xl">
          <span>{snack.text}</span>
          {snack.undo && (
            <button type="button" className="font-bold text-[#FF9A6E]" onClick={async () => { const u = snack.undo!; setSnack(null); await u(); }}>ביטול</button>
          )}
        </div>
      )}
      <ConfirmSheet open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} title={confirm?.title || ''} description={confirm?.text}
        confirmLabel="כן, שלח" cancelLabel="לא עכשיו" danger={false} onConfirm={() => confirm?.run()} />
    </div>
  );
}

function ErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mt-4 flex items-center gap-3 rounded-card bg-card px-4 py-3">
      <span className="text-2xl" aria-hidden>⚠️</span>
      <span className="min-w-0 flex-1"><b className="block font-extrabold text-ink-900">לא הצלחנו לטעון</b><small className="text-sm text-ink-500">שום דבר לא נשלח. אפשר לנסות שוב.</small></span>
      <button type="button" onClick={onRetry} className="min-h-[44px] font-bold text-brand-600">נסה שוב</button>
    </div>
  );
}

type Act = (fn: () => Promise<unknown>, s?: Snack) => Promise<void>;

function FeatureScreen({ feature, home, busy, onBack, setState, act, toast, router }: {
  feature: Feature; home: Home | undefined; busy: boolean; onBack: () => void; setState: (s: State) => void;
  act: Act; toast: (s: Snack) => void; router: ReturnType<typeof useRouter>;
}) {
  const s = home?.settings.find((x) => x.feature === feature);
  const up = useApi<Upcoming>(s && s.state !== 'off' ? `/api/admin/stories/upcoming?feature=${feature}` : null);
  const [person, setPerson] = useState<{ athleteId: string; period: string } | null>(null);
  const previewHref = feature === 'weekly' ? '/feed?weekStory=1' : feature === 'birthday' ? '/dashboard/birthdays' : '/feed?annualStory=1';
  const patch = async (p: Partial<Settings>, label: string) => {
    const before: Record<string, unknown> = {};
    for (const k of Object.keys(p)) before[k] = (s as unknown as Record<string, unknown>)[k];
    await act(() => send('/api/admin/stories', 'PUT', { feature, ...p }), {
      text: label, undo: () => act(() => send('/api/admin/stories', 'PUT', { feature, ...before })),
    });
    void up.mutate();
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <BackNav label="סיפורים" onBack={onBack} />
        {s && s.state !== 'off' && (
          <button type="button" onClick={() => router.push(previewHref)} className="flex min-h-[44px] items-center gap-1 text-[15px] font-bold text-ink-900"><Eye className="h-4 w-4" /> תצוגה</button>
        )}
      </div>
      <h1 className="mt-1 text-[30px] font-black text-ink-900">{META[feature].emoji} {META[feature].title}</h1>
      {!s ? <SkeletonList /> : (
        <>
          <div className="mt-3 grid grid-cols-4 gap-1 rounded-xl bg-[#E3E3E8] p-[3px]" role="radiogroup" aria-label={`מצב ${META[feature].title}`}>
            {STATES.map(([v, label]) => (
              <button key={v} type="button" role="radio" aria-checked={s.state === v} disabled={busy} onClick={() => setState(v)}
                className={cn('min-h-[42px] rounded-[10px] text-[14.5px]', s.state === v ? 'bg-white font-extrabold text-brand-600 shadow' : 'font-medium text-ink-700')}>
                {label}
              </button>
            ))}
          </div>

          {s.state === 'off' ? (
            <div className="mt-4 rounded-card bg-card px-4 py-5 text-center">
              <div className="text-4xl" aria-hidden>{META[feature].emoji}</div>
              <b className="mt-1 block text-[18px] font-extrabold text-ink-900">עוד לא הופעל</b>
              <p className="mx-auto mt-1 max-w-xs text-sm text-ink-500">{META[feature].empty}</p>
              <button type="button" disabled={busy} onClick={() => setState('self')} className="mt-3 min-h-[48px] w-full rounded-xl bg-[#FFF0EA] font-bold text-brand-600">נסה על עצמי</button>
            </div>
          ) : (
            <>
              <SettingsSentence feature={feature} s={s} busy={busy} onPatch={patch} />
              <TestersCard home={home!} busy={busy} act={act} active={s.state === 'testers'} />
              <UpcomingList feature={feature} up={up.data} error={!!up.error} onRetry={() => void up.mutate()} onOpen={(r) => setPerson({ athleteId: r.athleteId, period: r.period })} />
            </>
          )}
        </>
      )}
      {person && (
        <PersonSheet feature={feature} k={person} onClose={() => { setPerson(null); void up.mutate(); }} toast={toast} canEdit={home?.ready157 !== false} />
      )}
    </>
  );
}

/** "נשלח ב[שבת 18:00] · מוצג [יומיים] · רק למי [שרץ לפחות 1]" — each part is a chip you tap. */
function SettingsSentence({ feature, s, busy, onPatch }: { feature: Feature; s: Settings; busy: boolean; onPatch: (p: Partial<Settings>, label: string) => Promise<void> }) {
  const [edit, setEdit] = useState<null | 'time' | 'days' | 'runs'>(null);
  const [val, setVal] = useState('');
  const open = (k: 'time' | 'days' | 'runs', v: string) => { setEdit(k); setVal(v); };
  const save = async () => {
    if (edit === 'time') await onPatch({ generate_at: val }, `שעת שליחה: ${val}`);
    if (edit === 'days') await onPatch({ display_days: Number(val) }, `מוצג ${days(Number(val))}`);
    if (edit === 'runs') await onPatch({ min_runs: Number(val) }, `מינימום ${val} ריצות`);
    setEdit(null);
  };
  const Chip = ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => (
    <button type="button" disabled={busy} onClick={onClick} className="mx-0.5 inline-block rounded-[10px] bg-[#FFF0EA] px-2.5 font-bold leading-relaxed text-brand-600">{children}</button>
  );
  return (
    <div className="mt-3 rounded-card bg-card px-4 py-3 text-[16.5px] leading-[2.1] text-ink-900">
      נשלח {META[feature].when === 'שבת' ? 'בשבת' : META[feature].when}
      <Chip onClick={() => open('time', s.generate_at.slice(0, 5))}>{s.generate_at.slice(0, 5)}</Chip>
      · מוצג <Chip onClick={() => open('days', String(s.display_days))}>{days(s.display_days)}</Chip>
      · רק למי שרץ לפחות <Chip onClick={() => open('runs', String(s.min_runs))}>{s.min_runs}</Chip> {feature === 'weekly' ? 'השבוע' : 'בשנה'}
      · <Chip onClick={() => void onPatch({ send_push: !s.send_push }, s.send_push ? 'בלי התראה' : 'עם התראה')}>{s.send_push ? 'עם התראה' : 'בלי התראה'}</Chip>
      {feature === 'birthday' && (
        <> · <Chip onClick={() => void onPatch({ feed_post: !s.feed_post }, s.feed_post ? 'בלי פוסט בפיד' : 'עם פוסט בפיד')}>{s.feed_post ? 'עם פוסט בפיד' : 'בלי פוסט בפיד'}</Chip></>
      )}
      {edit && (
        <div className="mt-2 flex items-center gap-2">
          <input aria-label="ערך חדש" autoFocus value={val} onChange={(e) => setVal(e.target.value)}
            type={edit === 'time' ? 'time' : 'number'} min={edit === 'days' ? 1 : 0} max={edit === 'days' ? 31 : 365}
            className="min-h-[44px] flex-1 rounded-xl bg-page px-3 text-base" />
          <button type="button" onClick={() => void save()} className="min-h-[44px] rounded-xl bg-brand-600 px-4 font-bold text-white">שמור</button>
          <button type="button" onClick={() => setEdit(null)} className="min-h-[44px] px-2 text-ink-500">ביטול</button>
        </div>
      )}
    </div>
  );
}

const RECENT_KEY = 'stories:recentTesters';
function readRecent(): Athlete[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') as Athlete[]; } catch { return []; }
}

function TestersCard({ home, busy, act, active }: { home: Home; busy: boolean; act: Act; active: boolean }) {
  const { data: roster } = useApi<{ athletes: Athlete[] }>('/api/athletes');
  const [q, setQ] = useState('');
  const [recent, setRecent] = useState<Athlete[]>([]);
  useEffect(() => setRecent(readRecent()), []);
  const taken = new Set(home.testers.map((t) => t.athleteId));
  const matches = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    return (roster?.athletes || []).filter((a) => a.status === 'active' && !taken.has(a.id) && (a.name || '').toLowerCase().includes(term)).slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, roster, home.testers]);
  const add = (a: Athlete) => {
    const next = [a, ...readRecent().filter((r) => r.id !== a.id)].slice(0, 6);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* private mode */ }
    setRecent(next);
    setQ('');
    void act(() => send('/api/admin/stories/testers', 'POST', { athleteId: a.id }), {
      text: `${a.name || 'נוסף/ה'} נוסף/ה לבודקים`,
      undo: () => act(() => send(`/api/admin/stories/testers?athleteId=${a.id}`, 'DELETE')),
    });
  };
  const remove = (t: Tester) => void act(() => send(`/api/admin/stories/testers?athleteId=${t.athleteId}`, 'DELETE'), {
    text: `${t.name || ''} הוסר/ה מהבודקים`,
    undo: () => act(() => send('/api/admin/stories/testers', 'POST', { athleteId: t.athleteId })),
  });
  const recentFree = recent.filter((r) => !taken.has(r.id));
  return (
    <>
      <div className="mx-1.5 mb-1.5 mt-4 flex justify-between text-[13px] font-bold text-ink-400">
        <span>בודקים · משותף לכל הסיפורים{active ? '' : ' (בתוקף רק במצב ״בדיקה״)'}</span>
        <span className="text-accent-green" aria-live="polite">{home.testers.length}</span>
      </div>
      <div className="rounded-card bg-card px-4 py-3">
        <label className="flex min-h-[44px] items-center gap-2 rounded-xl bg-page px-3 text-ink-400">
          <Search className="h-4 w-4" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="הוסף בודק" aria-label="חיפוש בודק" className="flex-1 bg-transparent text-[15.5px] text-ink-900 outline-none" />
        </label>
        {matches.map((a) => (
          <button key={a.id} type="button" disabled={busy} onClick={() => add(a)} className="mt-1 block min-h-[44px] w-full rounded-xl px-3 text-start text-[15px] text-ink-900 hover:bg-page">+ {a.name}</button>
        ))}
        {!q && recentFree.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {recentFree.map((a) => (
              <button key={a.id} type="button" disabled={busy} onClick={() => add(a)} className="min-h-[36px] rounded-2xl border border-page bg-white px-3 text-sm text-ink-700">+ {a.name}</button>
            ))}
          </div>
        )}
        {home.testers.map((t) => (
          <div key={t.athleteId} className="flex min-h-[54px] items-center gap-3 border-b border-page last:border-0">
            <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#FFB08F] to-[#FF5315] font-bold text-white">{(t.name || '?').slice(0, 1)}</span>
            <span className="min-w-0 flex-1 text-[16px] text-ink-900">
              {t.name || t.athleteId.slice(0, 8)}
              <small className="block text-[13px] text-ink-400">{t.status !== 'active' ? 'לא פעיל' : t.viewed ? 'צפה/תה' : 'עוד לא צפה/תה'}</small>
            </span>
            <button type="button" disabled={busy} onClick={() => remove(t)} aria-label={`הסר ${t.name || ''}`} className="flex min-h-[44px] items-center gap-1 text-sm text-accent-red"><X className="h-3.5 w-3.5" /> הסר</button>
          </div>
        ))}
      </div>
    </>
  );
}

function UpcomingList({ feature, up, error, onRetry, onOpen }: { feature: Feature; up: Upcoming | undefined; error: boolean; onRetry: () => void; onOpen: (r: Row) => void }) {
  if (error) return <ErrorCard onRetry={onRetry} />;
  if (!up) return <div className="mt-4 rounded-card bg-card px-4 py-3"><small className="text-ink-400">טוען מי מקבל…</small><SkeletonList count={2} /></div>;
  const groups = BUCKETS.map(([b, label]) => [label, up.rows.filter((r) => r.bucket === b)] as const).filter(([, rows]) => rows.length);
  return (
    <>
      <div className="mx-1.5 mb-1.5 mt-4 text-[13px] font-bold text-ink-400">{feature === 'birthday' ? 'מי חוגג' : 'מי מקבל'}</div>
      <div className="rounded-card bg-card px-4 py-2">
        {groups.length === 0 && <p className="py-3 text-sm text-ink-500">{up.nextAt ? `הבא: ${dm(up.nextAt)}` : 'אין ימי הולדת בשבוע הקרוב'}</p>}
        {groups.map(([label, rows]) => (
          <div key={label}>
            <div className="mt-2 text-[13px] font-extrabold text-brand-600">{label}</div>
            {rows.map((r) => (
              <button key={`${r.athleteId}-${r.period}`} type="button" onClick={() => onOpen(r)} className="flex min-h-[54px] w-full items-center gap-3 border-b border-page text-start last:border-0">
                <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#FFB08F] to-[#FF5315] font-bold text-white">{(r.name || '?').slice(0, 1)}</span>
                <span className="min-w-0 flex-1 text-[16px] text-ink-900">
                  {r.name}
                  <small className={cn('block text-[12.5px]', r.status === 'ready' ? 'text-brand-600' : 'text-ink-400')}>
                    {r.status === 'ready' ? `${hhmm(r.publishAt)} · ${r.summary}` : STATUS_WORD[r.status] || r.status}
                  </small>
                </span>
                <ChevronLeft className="h-5 w-5 text-ink-300" />
              </button>
            ))}
          </div>
        ))}
        {up.total > up.rows.length && <p className="py-2 text-xs text-ink-400">ועוד {up.total - up.rows.length}</p>}
      </div>
      {feature === 'birthday' && up.noBirthDate.length > 0 && (
        <details className="mt-2 rounded-card bg-card px-4 py-3 text-sm text-ink-600">
          <summary className="min-h-[32px] cursor-pointer font-bold">אין תאריך לידה · {up.noBirthDate.length}</summary>
          <p className="mt-1">{up.noBirthDate.map((a) => a.name).filter(Boolean).join(', ')}</p>
        </details>
      )}
    </>
  );
}

function PersonSheet({ feature, k, onClose, toast, canEdit }: { feature: Feature; k: { athleteId: string; period: string }; onClose: () => void; toast: (s: Snack) => void; canEdit: boolean }) {
  const url = `/api/admin/stories/person?athleteId=${k.athleteId}&feature=${feature}&period=${k.period}`;
  const { data: p, mutate } = useApi<Person>(url);
  const [tab, setTab] = useState<'push' | 'feed' | 'story'>('story');
  const [headline, setHeadline] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (p) { setHeadline(p.headline ?? ''); setTime(hhmm(p.effective.publishAt)); } }, [p]);

  const patch = async (body: Record<string, unknown>, label: string) => {
    setBusy(true);
    try {
      const r = await send('/api/admin/stories/person', 'PATCH', { athleteId: k.athleteId, feature, period: k.period, ...body });
      await mutate();
      toast({ text: label, undo: async () => { await send('/api/admin/stories/person', 'PATCH', { athleteId: k.athleteId, feature, period: k.period, ...r.previous, undo: true }); await mutate(); } });
    } catch (e) {
      toast({ text: (e as Error).message === 'publish_at in the past' ? 'הזמן עבר. בחרו שעה בעתיד.' : `לא נשמר: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!p) return;
    const body: Record<string, unknown> = {};
    if ((headline || '') !== (p.headline || '')) body.custom_text = { headline: headline || null };
    if (time && time !== hhmm(p.effective.publishAt)) body.publish_at = israelWallToUtc(israelDateOf(p.effective.publishAt), time).toISOString();
    if (Object.keys(body).length) await patch(body, 'נשמר');
    onClose();
  };
  const reset = async () => {
    setBusy(true);
    try {
      const r = await send(`${url}`, 'DELETE');
      await mutate();
      toast({ text: 'חזר לברירת מחדל', undo: async () => { await send('/api/admin/stories/person', 'PATCH', { athleteId: k.athleteId, feature, period: k.period, ...r.previous, undo: true }); await mutate(); } });
    } catch { toast({ text: 'לא אופס' }); } finally { setBusy(false); }
  };

  const skipped = p?.effective.reason === 'skipped';
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={p?.name || '…'}>
      {!p ? <SkeletonList count={3} /> : (
        <div dir="rtl" className="pb-4">
          <p className="text-center text-sm text-ink-400">
            {dm(israelDateOf(p.effective.publishAt))} {hhmm(p.effective.publishAt)} · מוצג {days(p.effective.displayDays)}{p.pushed ? ' · ההתראה כבר נשלחה' : ''}
          </p>
          <div className="mt-2 flex justify-center gap-1.5" role="tablist">
            {([['push', 'התראה'], ['feed', 'בפיד'], ['story', 'הסיפור']] as const).map(([t, l]) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn('min-h-[32px] rounded-xl px-3 text-[13px]', tab === t ? 'bg-ink-900 text-white' : 'bg-[#E3E3E8]')}>{l}</button>
            ))}
          </div>
          {tab === 'push' && (
            <div className="mt-3 rounded-2xl bg-[#3a2a6a] p-4">
              <div className="rounded-2xl bg-white/90 px-3 py-2.5 text-[14.5px]">
                <div className="flex justify-between"><b>מדרגות</b><span className="text-xs text-ink-400">{hhmm(p.effective.publishAt)}</span></div>
                {p.push ? <><b className="block">{p.push.title}</b>{p.push.body}</> : 'אין עדיין נתונים להתראה'}
                {!p.settings.send_push && <small className="block text-accent-red">ההתראות כבויות לסיפור הזה</small>}
              </div>
            </div>
          )}
          {tab === 'feed' && (
            <div className="mt-3 rounded-2xl bg-card p-4 text-sm text-ink-700">
              {feature === 'birthday'
                ? (p.effective.feedPost ? '🎂 פוסט בפיד המועדון ב־06:00 (שם בלבד, בלי גיל ובלי נתונים)' : 'בלי פוסט בפיד המועדון')
                : 'כרטיס בראש הפיד שלו/ה, רק לו/ה'}
            </div>
          )}
          {tab === 'story' && (
            <div className="relative mt-3 flex h-[300px] flex-col justify-between rounded-[20px] bg-gradient-to-br from-[#FF5315] to-[#FF9A6E] p-4 text-white">
              <span className="self-start rounded-xl bg-white/25 px-2.5 py-0.5 text-[12.5px]">✎ הקש לעריכה</span>
              <div>
                <input value={headline ?? ''} onChange={(e) => setHeadline(e.target.value)} disabled={!canEdit} maxLength={80}
                  placeholder={feature === 'birthday' ? `${p.name || ''}, מזל טוב 🎉` : `${p.name || ''}, השנה שלך`}
                  aria-label="כותרת אישית" className="w-full rounded-md bg-transparent text-[25px] font-extrabold text-white outline-dashed outline-2 outline-offset-4 outline-white/80 placeholder:text-white/70" />
                <div className="mt-1.5 text-[15px] opacity-90">
                  {p.numbers ? `${p.numbers.km.toLocaleString('en-US')} ק״מ · ${p.numbers.runs} ריצות${p.numbers.streak ? ` · רצף ${p.numbers.streak} ימים` : ''}` : 'אין עדיין נתונים'}
                </div>
              </div>
            </div>
          )}
          {p.effective.reason === 'min_runs' && <p className="mt-2 text-center text-xs text-accent-red">מתחת למינימום ({p.settings.min_runs} ריצות): לא יישלח</p>}
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={busy || !canEdit} onClick={() => void patch({ action: 'plus_day' }, `מוצג ${days(Math.min(31, p.effective.displayDays + 1))}`)} className="min-h-[44px] flex-1 rounded-xl border border-page bg-white text-[14.5px] font-bold">+1 יום</button>
            <button type="button" disabled={busy || !canEdit || p.pushed} onClick={() => void patch({ action: 'postpone' }, 'נדחה למחר')} className="min-h-[44px] flex-1 rounded-xl border border-page bg-white text-[14.5px] font-bold">דחה למחר</button>
            <button type="button" disabled={busy || !canEdit} onClick={() => void patch({ action: skipped ? 'unskip' : 'skip_year' }, skipped ? 'חזר לתור' : 'דילוג השנה')} className="min-h-[44px] flex-1 rounded-xl border border-page bg-white text-[14.5px] font-bold text-accent-red">{skipped ? 'בטל דילוג' : 'דלג השנה'}</button>
          </div>
          <div className="rounded-card bg-card px-4">
            <label className="flex min-h-[48px] items-center gap-3 border-b border-page">
              <span className="flex-1">שעה</span>
              <input type="time" value={time ?? ''} disabled={!canEdit || p.pushed} onChange={(e) => setTime(e.target.value)} className="rounded-[10px] bg-[#FFF0EA] px-2 font-bold text-brand-600" />
            </label>
            {feature === 'birthday' && (
              <div className="flex min-h-[48px] items-center gap-3">
                <span className="flex-1">פוסט בפיד המועדון{!p.settings.feed_post && <small className="block text-xs text-ink-400">כבוי לכל המועדון בהגדרות</small>}</span>
                <Switch checked={p.effective.feedPost} disabled={busy || !canEdit || !p.settings.feed_post} onChange={(v) => void patch({ feed_post: v ? null : false }, v ? 'עם פוסט' : 'בלי פוסט')} ariaLabel="פוסט בפיד המועדון" />
              </div>
            )}
          </div>
          <button type="button" disabled={busy || !canEdit} onClick={() => void save()} className="mt-4 min-h-[52px] w-full rounded-2xl bg-brand-600 text-[17px] font-bold text-white">שמור</button>
          <button type="button" disabled={busy || !canEdit} onClick={() => void reset()} className="mt-1 min-h-[44px] w-full text-[15px] text-brand-600">בטל שינויים</button>
          {!canEdit && <p className="text-center text-xs text-ink-400">שינויים לאדם אחד: אחרי מיגרציה 157</p>}
        </div>
      )}
    </Sheet>
  );
}
