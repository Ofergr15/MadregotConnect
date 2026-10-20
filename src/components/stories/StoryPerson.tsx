'use client';

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiHeaders, useApi } from '@/lib/api';
import { Switch } from '@/components/ui';
import { CheerCirclePreview, FeedPreview, LockPreview, PreviewStage, draftItem, type Place } from '@/components/publish/PublishPreview';
import { BirthdayPrep } from '@/components/birthday/BirthdayPrep';
import { birthdayBody } from '@/lib/feed/birthday';
import { DURATIONS, PLACEMENT_LABEL, dayWord, durationOf, saveBody, shortDate, type Duration } from '@/lib/stories/area';
import { israelWallToUtc, PLACEMENTS, type Placement } from '@/lib/stories/instances';
import type { BirthdayConfig } from '@/lib/birthday-year/server';
import type { StoryFeature, StoryState } from '@/lib/stories/gate';
import { cn } from '@/lib/utils';

// One person's story — Content › stories v5 (mockup stories-area, Ofer 10-20): the same
// screen as publishing a cheer. Birthday has the public part (post / circle) and the prep;
// weekly and annual are the person's own story and its push, nothing public. On top, how it will look in each place it reaches (the
// feed's own cards and circles); below, where it shows, how long, the push, and what is
// inside. "שמירה" goes out at its time; "לפרסם עכשיו" only on the day itself.

interface Person {
  name: string | null; avatarUrl: string | null; state: StoryState; today: string; pushed: boolean;
  effective: { on: boolean; reason: string | null; publishAt: string; until: string; displayDays: number; feedPost: boolean; placement: Placement; sendPush: boolean; manualUntil: boolean };
  settings: { feed_post: boolean; send_push: boolean };
  push: { title: string; body: string } | null;
  instance: { skipped?: boolean } | null;
}
interface Prep { athleteId: string; name: string | null; birthday: string; config: BirthdayConfig }

const VARS: Record<StoryFeature, CSSProperties> = {
  birthday: { '--c': '#e0306e', '--c2': '#fde8ef', '--ci': '#a01d4c' } as CSSProperties,
  weekly: { '--c': '#1f6feb', '--c2': '#e8f0fe', '--ci': '#174ea6' } as CSSProperties,
  annual: { '--c': '#7638FA', '--c2': '#f1e8ff', '--ci': '#4c1d95' } as CSSProperties,
};
/** ISO → the datetime-local value, Israel wall clock. */
const toInput = (iso: string) => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(iso));
  const g = (k: string) => p.find((x) => x.type === k)?.value ?? '00';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
};
const fromInput = (v: string) => (v ? israelWallToUtc(v.slice(0, 10), v.slice(11, 16)).toISOString() : null);
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });

const TITLE: Record<StoryFeature, string> = { birthday: 'יום הולדת', weekly: 'סיכום שבועי', annual: 'סיכום שנתי' };

export function StoryPerson({ feature, athleteId, period, backHref }: { feature: StoryFeature; athleteId: string; period: string; backHref: string }) {
  const router = useRouter();
  const isBirthday = feature === 'birthday';
  const key = `athleteId=${encodeURIComponent(athleteId)}&feature=${feature}&period=${period}`;
  const { data: p, error, mutate } = useApi<Person>(`/api/admin/stories/person?${key}`);
  const { data: prep } = useApi<{ rows: Prep[] }>(isBirthday ? '/api/admin/birthdays' : null);
  const row = prep?.rows.find((r) => r.athleteId === athleteId && r.birthday === period);

  const [placement, setPlacement] = useState<Placement>('both');
  const [duration, setDuration] = useState<Duration>(3);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [push, setPush] = useState(true);
  const [prepOpen, setPrepOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  useEffect(() => {
    if (!p) return;
    setPlacement(p.effective.placement);
    setDuration(durationOf(p.effective));
    setFrom(toInput(p.effective.publishAt));
    setTo(toInput(p.effective.until));
    setPush(p.effective.sendPush);
  }, [p]);

  const first = (row?.config.displayName || p?.name || '').trim().split(/\s+/)[0];
  const body = birthdayBody(first || 'חבר/ה', athleteId);
  const publicOn = isBirthday && !!p?.settings.feed_post;
  const places: Place[] = [];
  if (publicOn && placement !== 'circle') places.push('feed');
  if (publicOn && placement !== 'feed') places.push('circle');
  if (push && p?.settings.send_push) places.push('push');

  const startIso = duration === 'manual' ? fromInput(from) : p?.effective.publishAt ?? null;
  const endIso = duration === 'manual' ? fromInput(to)
    : startIso ? new Date(new Date(startIso).getTime() + (duration as number) * 86_400_000).toISOString() : null;
  const isToday = !!p && period === p.today;
  const live = p?.state === 'testers' || p?.state === 'all';
  const skipped = !!p?.instance?.skipped;

  const patch = async (extra: Record<string, unknown>, done: string) => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/admin/stories/person', { method: 'PATCH', headers: await apiHeaders(true), body: JSON.stringify({ athleteId, feature, period, ...extra }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error === 'publish_at in the past' || json.error === 'until_at in the past' ? 'הזמן עבר. בחרו שעה בעתיד.' : json.error === 'until_at before publish_at' ? 'הסוף לפני ההתחלה' : 'השמירה נכשלה');
      setMsg({ text: json.warning ? `${done} · חלק מהבחירות יישמרו אחרי מיגרציה 162` : done });
      await mutate();
    } catch (e) {
      setMsg({ text: (e as Error).message, bad: true });
    } finally { setBusy(false); }
  };

  const save = (now = false) => {
    const b = saveBody({ placement, duration, from: fromInput(from), to: fromInput(to), push });
    if (!isBirthday) delete b.placement;
    // The week story's window is fixed: only the push and skipping are per person.
    if (feature === 'weekly') { delete b.display_days; delete b.until_at; delete b.publish_at; }
    // The start only when it was moved by hand — an unchanged past start would be refused.
    if (duration !== 'manual' || (p && from === toInput(p.effective.publishAt))) delete b.publish_at;
    return patch(now ? { ...b, action: 'publish_now' } : b, now ? 'פורסם' : 'נשמר');
  };

  if (error) return <p className="p-4 text-sm font-bold text-accent-red-ink" dir="rtl">לא הצלחנו לטעון</p>;

  return (
    <div style={VARS[feature]} className="pb-2" dir="rtl">
      <div className="flex h-11 items-center justify-between">
        <Link href={backHref} className="inline-flex min-h-[44px] items-center text-[17px] text-[#007aff]">‹ {TITLE[feature]}</Link>
        <span className="text-13 text-ink-400">{first}{period ? ` · ${p ? dayWord(period, p.today) : ''} ${shortDate(period)}` : ''}</span>
      </div>

      {p && (
        <PreviewStage places={places}>
          {(at) => at === 'feed'
            ? <FeedPreview item={draftItem({ body, payload: { birthdayOf: athleteId, honoreeId: athleteId, date: period } })} pinnedUntil={null} />
            : at === 'circle'
              ? <CheerCirclePreview name={first} type="birthday" text={body.replace(/@\[([^\]]+)\]\([0-9a-f-]{36}\)/gi, '@$1')} />
              : <LockPreview title={p.push?.title ?? ''} body={p.push?.body ?? ''} />}
        </PreviewStage>
      )}
      {p && places.length === 0 && (
        <p className="rounded-[18px] bg-card px-4 py-3 text-13 text-ink-400">כרגע זה לא מופיע בשום מקום: הפוסט, העיגול וההתראה כבויים.</p>
      )}

      <div className="mt-2.5 overflow-hidden rounded-[18px] bg-card">
        {isBirthday && <div className="border-b-[0.5px] border-black/[0.08] px-4 pb-3 pt-3">
          <b className="block text-[15px] text-ink-900">איפה זה מופיע</b>
          {publicOn ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PLACEMENTS.map((pl) => <Chip key={pl} on={placement === pl} onClick={() => setPlacement(pl)}>{PLACEMENT_LABEL[pl]}</Chip>)}
            </div>
          ) : <small className="block text-13 text-ink-400">הפוסט והעיגול כבויים לכל המועדון (במסך יום הולדת, ״לכולם״)</small>}
        </div>}
        {feature !== 'weekly' && <div className="px-4 pb-3 pt-3">
          <b className="block text-[15px] text-ink-900">כמה זמן</b>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {DURATIONS.map(([d, label]) => <Chip key={String(d)} on={duration === d} onClick={() => setDuration(d)}>{label}</Chip>)}
          </div>
          {duration === 'manual' && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="block"><span className="mb-1 block text-12 font-bold text-ink-400">מתחיל</span>
                <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} dir="ltr" className="min-h-[44px] w-full rounded-xl bg-page px-2 text-[14px] font-bold" /></label>
              <label className="block"><span className="mb-1 block text-12 font-bold text-ink-400">נגמר</span>
                <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} dir="ltr" className="min-h-[44px] w-full rounded-xl bg-page px-2 text-[14px] font-bold" /></label>
            </div>
          )}
        </div>}
        <div className="flex min-h-[60px] items-center gap-3 border-t-[0.5px] border-black/[0.08] px-4 py-2">
          <span className="min-w-0 flex-1">
            <b className="block text-[15px] text-ink-900">התראה ל{first || 'חוגג/ת'}</b>
            <small className="block truncate text-13 text-ink-400">
              {p?.settings.send_push === false ? 'התראות כבויות לכל המועדון' : p ? `${feature === 'weekly' ? 'שבת מ־12:00' : `${dayWord(dayOf(p.effective.publishAt), p.today)} ${clock(p.effective.publishAt)}`} · ״${p.push?.title ?? ''}״` : ''}
            </small>
          </span>
          <Switch checked={push && p?.settings.send_push !== false} onChange={setPush} disabled={p?.settings.send_push === false} activeColor="bg-[#1FA55B]" ariaLabel="התראה" />
        </div>
      </div>

      {startIso && endIso && (
        <div className="mt-2.5 rounded-[18px] bg-card px-4 py-3 text-[13.5px] leading-[1.8] text-ink-700">
          {places.includes('circle') && <div>⭕ עיגול מדרגות · {rangeLabel(startIso, endIso, p!.today)}</div>}
          {places.includes('feed') && <div>📰 פוסט בפיד · {rangeLabel(startIso, endIso, p!.today)}</div>}
          {places.includes('push') && <div>🔔 התראה ל{first} · {feature === 'weekly' ? 'שבת מ־12:00' : `${dayWord(dayOf(startIso), p!.today)} ${clock(startIso)}`}</div>}
          <div className="text-ink-400">{publicOn && placement !== 'feed' ? 'העיגול: כל המועדון · ' : ''}{isBirthday ? '״השנה שלך״' : 'הסיפור'}: רק {first}</div>
        </div>
      )}

      {isBirthday && <div className="mt-2.5 overflow-hidden rounded-[18px] bg-card">
        <button type="button" onClick={() => setPrepOpen(!prepOpen)} className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-start">
          <span className="min-w-0 flex-1">
            <b className="block text-[15px] text-ink-900">מה בפנים <span className="text-13 font-semibold text-ink-400">· לא חובה</span></b>
            <small className="block text-13 text-ink-400">
              {row ? `${Object.keys(row.config.photos || {}).length} תמונות · ${row.config.message ? 'יש מילה אישית' : 'בלי מילה אישית'}` : 'נפתח כשיום הולדת דולק'}
            </small>
          </span>
          <span className="text-13 font-bold" style={{ color: 'var(--c)' }}>{prepOpen ? 'סגירה' : 'להכין'}</span>
        </button>
        {prepOpen && row && <BirthdayPrep row={row} />}
      </div>}

      <button type="button" disabled={busy} onClick={() => void patch({ action: skipped ? 'unskip' : 'skip_year' }, skipped ? 'חזר' : 'לא יישלח השנה')}
        className="mt-3 block w-full py-2 text-center text-13 text-ink-400">{skipped ? 'בכל זאת לשלוח' : `לא לשלוח ל${first || 'חוגג/ת'} ${isBirthday ? 'השנה' : 'הפעם'}`}</button>

      {msg && <p role="status" className={cn('mt-1 text-center text-13 font-bold', msg.bad ? 'text-accent-red-ink' : 'text-[#15803d]')}>{msg.text}</p>}

      {/* Sticky in the page's own scroller, like the publish screen: a fixed bar sat behind the tab bar. */}
      <div className="sticky bottom-0 z-20 -mx-1 mt-3 rounded-t-[20px] border-t border-[#E6E6EC] bg-page/95 px-1 pb-3 pt-3 backdrop-blur">
        <div className="flex gap-2">
          <button type="button" disabled={busy || !p || skipped} onClick={() => void save()}
            className="min-h-[52px] flex-1 rounded-[16px] bg-card text-[16px] font-extrabold disabled:opacity-50" style={{ color: 'var(--c)' }}>שמירה</button>
          {isBirthday && isToday && live && !p?.pushed && !skipped && (
            <button type="button" disabled={busy} onClick={() => void save(true)}
              className="min-h-[52px] flex-1 rounded-[16px] text-[16px] font-extrabold text-white disabled:opacity-50" style={{ background: 'var(--c)' }}>🎂 לפרסם עכשיו</button>
          )}
        </div>
        {!live && p && <p className="mt-1 text-center text-12 text-ink-400">{TITLE[feature]} {p.state === 'off' ? 'כבוי' : 'במצב ״רק אני״'}: נשמר, ויוצא כשמדליקים · <button type="button" onClick={() => router.push(backHref)} className="font-bold underline">להדליק</button></p>}
      </div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={cn('min-h-[36px] rounded-full px-3 text-13 font-bold', on ? 'bg-ink-900 text-white' : 'bg-page text-ink-600')}>{children}</button>
  );
}

/** "היום 06:00 עד ה׳ 23.10 20:00": a far day with its date. */
function rangeLabel(a: string, b: string, today: string) {
  const d = (iso: string) => { const w = dayWord(dayOf(iso), today); return w === 'היום' || w === 'מחר' ? w : shortDate(dayOf(iso)); };
  return `${d(a)} ${clock(a)} עד ${d(b)} ${clock(b)}`;
}
