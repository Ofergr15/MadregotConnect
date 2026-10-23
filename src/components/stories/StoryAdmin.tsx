'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronLeft, Play, Search, X } from 'lucide-react';
import { apiHeaders, useApi } from '@/lib/api';
import { FeedAvatar } from '@/components/FeedAvatar';
import { Sheet, Switch } from '@/components/ui';
import { Group, SectionHead } from '@/components/content/hub-ui';
import type { StoryFeature, StoryState } from '@/lib/stories/gate';
import { cn } from '@/lib/utils';
import { personMatches } from '@/lib/search/match';

// The pieces every story's screen is made of — Content › stories v5 (mockup stories-area,
// Ofer 10-20, "weekly and annual on the new screen too"): the state with one button, how
// and when it goes out, the shared testers, who gets it. Birthday, weekly and annual use
// the same parts, so the three screens read the same.

export interface FeatureSettingsRow {
  feature: StoryFeature; state: StoryState; send_push: boolean; feed_post: boolean;
  generate_at: string; display_days: number; min_runs: number;
}
export interface StoriesHome {
  ready: boolean; paused: boolean; settings: FeatureSettingsRow[];
  testers: Array<{ athleteId: string; name: string | null; status: string | null; viewed: boolean }>;
  reach?: Record<string, Record<StoryState, number>>;
}

export const STATES: Array<[StoryState, string, string]> = [
  ['off', 'כבוי', 'שום דבר לא יוצא'],
  ['self', 'רק אני', 'רק את/ה רואה, לתצוגה. בלי התראות'],
  ['testers', 'בדיקה', 'רק לבודקים'],
  ['all', 'כולם', 'כל מי שבמועדון'],
];

export async function putStories(body: Record<string, unknown>) {
  const res = await fetch('/api/admin/stories', { method: 'PUT', headers: await apiHeaders(true), body: JSON.stringify(body) });
  if (!res.ok) throw new Error('save');
}

/** The state, and one button that opens the four states with how many each reaches. */
export function StateCard({ feature, home, onChanged }: { feature: StoryFeature; home: StoriesHome | undefined; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const state = home?.settings.find((s) => s.feature === feature)?.state ?? 'off';
  const pick = async (s: StoryState) => {
    setBusy(true);
    try { await putStories({ feature, state: s }); onChanged(); setOpen(false); } finally { setBusy(false); }
  };
  const row = STATES.find((s) => s[0] === state)!;
  return (
    <>
      <div className="flex min-h-[64px] items-center gap-3 rounded-[16px] bg-card px-3.5 py-2.5">
        <span className={cn('h-3 w-3 rounded-full', state === 'all' ? 'bg-[#1FA55B]' : state === 'off' ? 'bg-[#c7c7cc]' : 'bg-[#D97706]')} />
        <span className="min-w-0 flex-1">
          <b className="block text-[16px] text-ink-900">{row[1]}{home?.paused ? ' · הכל מושהה' : ''}</b>
          <small className="block text-13 text-ink-400">{row[2]}</small>
        </span>
        <button type="button" onClick={() => setOpen(true)} className="min-h-[38px] rounded-full bg-ink-900 px-4 text-[14px] font-bold text-white">
          {state === 'off' ? 'להדליק' : 'לשנות'}
        </button>
      </div>
      <Sheet open={open} onOpenChange={setOpen} title="מי מקבל">
        <div className="space-y-2 px-4 pb-6" dir="rtl">
          {STATES.map(([s, label, sub]) => (
            <button key={s} type="button" disabled={busy} onClick={() => void pick(s)}
              className={cn('flex min-h-[60px] w-full items-center gap-3 rounded-[16px] px-3.5 py-2.5 text-start', s === state ? 'bg-ink-900 text-white' : 'bg-page')}>
              <span className="min-w-0 flex-1">
                <b className="block text-[16px]">{label}</b>
                <small className={cn('block text-13', s === state ? 'text-white/70' : 'text-ink-400')}>
                  {sub}{(s === 'testers' || s === 'all') && home?.reach?.[feature] ? ` · ${home.reach[feature][s]} אנשים` : ''}
                </small>
              </span>
            </button>
          ))}
        </div>
      </Sheet>
    </>
  );
}

const DAYS: Array<[number, string]> = [[1, 'יום'], [2, 'יומיים'], [3, '3 ימים'], [7, 'שבוע']];
const WHEN: Record<StoryFeature, string> = { weekly: 'בשבת', birthday: 'ביום ההולדת', annual: 'ב־31.12' };

/** How and when it goes out, for everyone: the time, how long, the minimum runs, the push — and for birthday the public post. */
export function FeatureSettings({ feature, home, onChanged }: { feature: StoryFeature; home: StoriesHome | undefined; onChanged: () => void }) {
  const s = home?.settings.find((x) => x.feature === feature);
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (s) setTime(s.generate_at.slice(0, 5)); }, [s]);
  if (!s) return null;
  const save = async (p: Record<string, unknown>) => {
    setBusy(true);
    try { await putStories({ feature, ...p }); onChanged(); } finally { setBusy(false); }
  };
  const line = 'border-t-[0.5px] border-black/[0.08]';
  // The week story's window is fixed (lib/week-story: Saturday 12:00 to Sunday 20:00, and
  // only who ran gets it) — so its screen says so instead of offering knobs the cron ignores.
  const weekly = feature === 'weekly';
  return (
    <>
      <SectionHead gray>לכולם</SectionHead>
      <div className="overflow-hidden rounded-[18px] bg-card">
        {weekly && (
          <div className="px-4 py-3">
            <b className="block text-[15px] text-ink-900">שבת 12:00 עד ראשון 20:00</b>
            <small className="block text-13 text-ink-400">קבוע, אחרי הארוכה. רק מי שרץ השבוע מקבל.</small>
          </div>
        )}
        {!weekly && <><label className="flex min-h-[56px] items-center gap-3 px-4 py-2">
          <span className="min-w-0 flex-1"><b className="block text-[15px] text-ink-900">שעה</b><small className="block text-13 text-ink-400">{WHEN[feature]}</small></span>
          <input type="time" value={time} disabled={busy} onChange={(e) => setTime(e.target.value)} onBlur={() => { if (time && time !== s.generate_at.slice(0, 5)) void save({ generate_at: time }); }}
            dir="ltr" className="min-h-[40px] rounded-xl bg-page px-3 text-[15px] font-bold" aria-label="שעה" />
        </label>
        <div className={cn('px-4 pb-3 pt-3', line)}>
          <b className="block text-[15px] text-ink-900">כמה זמן מוצג</b>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {DAYS.map(([d, label]) => (
              <button key={d} type="button" disabled={busy} aria-pressed={s.display_days === d} onClick={() => void save({ display_days: d })}
                className={cn('min-h-[36px] rounded-full px-3 text-13 font-bold', s.display_days === d ? 'bg-ink-900 text-white' : 'bg-page text-ink-600')}>{label}</button>
            ))}
          </div>
        </div>
        <div className={cn('flex min-h-[56px] items-center gap-3 px-4 py-2', line)}>
          <span className="min-w-0 flex-1"><b className="block text-[15px] text-ink-900">רק למי שרץ לפחות</b><small className="block text-13 text-ink-400">ריצות בשנה</small></span>
          <span className="flex items-center gap-2">
            <button type="button" disabled={busy || s.min_runs <= 0} onClick={() => void save({ min_runs: s.min_runs - 1 })} aria-label="פחות" className="grid h-9 w-9 place-items-center rounded-full bg-page text-[18px] font-bold">−</button>
            <b className="w-7 text-center text-[16px]">{s.min_runs}</b>
            <button type="button" disabled={busy} onClick={() => void save({ min_runs: s.min_runs + 1 })} aria-label="יותר" className="grid h-9 w-9 place-items-center rounded-full bg-page text-[18px] font-bold">+</button>
          </span>
        </div>
        </>}
        <div className={cn('flex min-h-[56px] items-center gap-3 px-4 py-2', line)}>
          <span className="min-w-0 flex-1"><b className="block text-[15px] text-ink-900">התראה</b><small className="block text-13 text-ink-400">{s.send_push ? 'כל מי שמקבל, מקבל התראה' : 'עולה בשקט, בלי התראה'}</small></span>
          <Switch checked={s.send_push} onChange={(v) => void save({ send_push: v })} loading={busy} activeColor="bg-[#1FA55B]" ariaLabel="התראה" />
        </div>
        {feature === 'birthday' && (
          <div className={cn('flex min-h-[56px] items-center gap-3 px-4 py-2', line)}>
            <span className="min-w-0 flex-1"><b className="block text-[15px] text-ink-900">פוסט ועיגול בפיד</b><small className="block text-13 text-ink-400">{s.feed_post ? 'כל המועדון רואה ביום ההולדת' : 'כבוי: רק החוגג מקבל, אף אחד לא רואה'}</small></span>
            <Switch checked={s.feed_post} onChange={(v) => void save({ feed_post: v })} loading={busy} activeColor="bg-[#1FA55B]" ariaLabel="פוסט ועיגול בפיד" />
          </div>
        )}
      </div>
    </>
  );
}

interface Athlete { id: string; name: string | null; status?: string | null }

/** The testers — one list for all the stories. */
export function TestersCard({ home, onChanged, onWatch }: { home: StoriesHome; onChanged: () => void; onWatch?: (athleteId: string) => void }) {
  const { data: roster } = useApi<{ athletes: Athlete[] }>('/api/athletes');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const taken = useMemo(() => new Set(home.testers.map((t) => t.athleteId)), [home.testers]);
  const term = q.trim().toLowerCase();
  const matches = term ? (roster?.athletes || []).filter((a) => a.status === 'active' && !taken.has(a.id) && personMatches(a.name, term)).slice(0, 6) : [];
  const call = async (url: string, method: string, body?: unknown) => {
    setBusy(true);
    try {
      await fetch(url, { method, headers: await apiHeaders(true), body: body ? JSON.stringify(body) : undefined });
      onChanged();
    } finally { setBusy(false); }
  };
  return (
    <>
      <SectionHead gray trailing={<span className="text-[#15803d]">{home.testers.length}</span>}>בודקים · משותף לכל הסיפורים</SectionHead>
      <div className="overflow-hidden rounded-[18px] bg-card">
        <label className="m-2.5 flex min-h-[44px] items-center gap-2 rounded-xl bg-page px-3 text-ink-400">
          <Search className="h-4 w-4" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="להוסיף בודק" aria-label="חיפוש בודק" className="flex-1 bg-transparent text-base text-ink-900 outline-none" />
        </label>
        {matches.map((a) => (
          <button key={a.id} type="button" disabled={busy} onClick={() => { setQ(''); void call('/api/admin/stories/testers', 'POST', { athleteId: a.id }); }}
            className="block min-h-[44px] w-full px-4 text-start text-[15px] text-ink-900 active:bg-page">+ {a.name}</button>
        ))}
        {home.testers.map((t) => (
          <div key={t.athleteId} className="flex min-h-[56px] items-center gap-3 border-t-[0.5px] border-black/[0.08] px-3.5">
            <FeedAvatar name={t.name || ''} url={null} className="h-9 w-9 text-[13px]" />
            <span className="min-w-0 flex-1 text-[15px] text-ink-900">
              {t.name || t.athleteId.slice(0, 8)}
              <small className="block text-12 text-ink-400">{t.status !== 'active' ? 'לא פעיל' : t.viewed ? 'צפה/תה' : 'עוד לא צפה/תה'}</small>
            </span>
            {onWatch && t.status === 'active' && <PlayButton name={t.name} onClick={() => onWatch(t.athleteId)} />}
            <button type="button" disabled={busy} onClick={() => void call(`/api/admin/stories/testers?athleteId=${t.athleteId}`, 'DELETE')} aria-label={`להסיר את ${t.name || ''}`}
              className="flex min-h-[44px] items-center gap-1 text-13 font-bold text-accent-red-ink"><X className="h-3.5 w-3.5" /> להסיר</button>
          </div>
        ))}
      </div>
    </>
  );
}

const STATUS_WORD: Record<string, string> = {
  preview_only: 'רק אני', gate_off: 'כבוי', paused: 'מושהה', not_tester: 'לא בבודקים',
  opted_out: 'ביקש/ה לא לקבל', inactive: 'לא פעיל', skipped: 'דילוג', disabled: 'כבוי לאדם הזה',
};

export interface UpRow { athleteId: string; name: string | null; avatarUrl?: string | null; period: string; bucket: string; status: string; summary: string; publishAt: string }

/** Who gets it next, each opening their own screen. */
export function ReceiversList({ rows, href, empty, onWatch }: { rows: UpRow[]; href: (r: UpRow) => string; empty?: ReactNode; onWatch?: (r: UpRow) => void }) {
  if (rows.length === 0) return empty ? <>{empty}</> : null;
  return (
    <>
      <SectionHead gray trailing={<span>{rows.length}</span>}>מי מקבל</SectionHead>
      <Group>
        {rows.map((r) => (
          <div key={`${r.athleteId}:${r.period}`} className="flex min-h-[60px] items-center gap-2 pe-1.5 ps-3.5">
            <Link href={href(r)} className="flex min-w-0 flex-1 items-center gap-3 py-2 active:opacity-70">
              <FeedAvatar name={r.name || ''} url={r.avatarUrl ?? null} className="h-9 w-9 text-[13px]" />
              <span className="min-w-0 flex-1">
                <b dir="auto" className="block truncate text-[15px] font-semibold text-ink-900">{r.name}</b>
                <small className="block truncate text-12 text-ink-400">{r.status === 'ready' ? (r.summary === 'ברירת מחדל' ? 'כמו כולם' : r.summary) : STATUS_WORD[r.status] || r.status}</small>
              </span>
              <ChevronLeft className="h-4 w-4 shrink-0 text-[#c4c4c9]" />
            </Link>
            {onWatch && r.status === 'ready' && <PlayButton name={r.name} onClick={() => onWatch(r)} />}
          </div>
        ))}
      </Group>
    </>
  );
}

/** ▶ on a person's row: their story, opened right here (WatchWeekStory). */
function PlayButton({ name, onClick }: { name: string | null; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={`לצפות בסטורי של ${name || ''}`}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-white active:scale-95" style={{ background: 'var(--c, #1f6feb)' }}>
      <Play className="ms-0.5 h-4 w-4" fill="currentColor" strokeWidth={0} />
    </button>
  );
}
