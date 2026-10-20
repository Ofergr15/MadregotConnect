'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronLeft, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Place } from '@/lib/search/places';
import type { RunResults } from '@/lib/search/runs';
import type { WeekSession } from '@/lib/plans/workout-parsing';
import { teammateHref } from '@/lib/athletes/profile-link';

// The search screen's new result sets — mockup ~/.cache/madregot/search-proposal.html, Ofer
// 2026-10-20: the filter tabs, screens and settings by role, runs by what the workout was,
// this week's plan in my pack, my records, what to do with a person, and recent searches.

export type SearchTab = 'all' | 'people' | 'runs' | 'plan' | 'places';
export const SEARCH_TABS: SearchTab[] = ['all', 'people', 'runs', 'plan', 'places'];

const head = 'mb-1.5 px-1 text-2xs font-bold uppercase tracking-wider text-ink-400';
const row = 'flex min-h-[58px] items-center gap-3 border-t border-page/60 px-3.5 py-2 first:border-t-0 active:bg-page/40';
const Box = ({ children }: { children: React.ReactNode }) => <div className="overflow-hidden rounded-card bg-card">{children}</div>;
const Chev = () => <ChevronLeft className="h-4 w-4 shrink-0 text-ink-300 ltr:rotate-180" />;
const Emoji = ({ e }: { e: string }) => <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-page text-[17px]">{e}</span>;
const dm = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}`;
const clock = (s: number) => { const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const x = Math.round(s % 60); return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };

export function SearchTabs({ tab, onTab, counts }: { tab: SearchTab; onTab: (t: SearchTab) => void; counts: Partial<Record<SearchTab, number>> }) {
  const t = useTranslations('search');
  return (
    <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1" role="tablist">
      {SEARCH_TABS.map((k) => (
        <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => onTab(k)}
          className={cn('min-h-[36px] shrink-0 rounded-pill px-3.5 text-[13.5px] font-extrabold', tab === k ? 'bg-ink-900 text-white' : 'bg-card text-ink-600')}>
          {t(`tab_${k}` as 'tab_all')}{k !== 'all' && counts[k] ? <span className="ms-1 opacity-60"><bdi dir="ltr">{counts[k]}</bdi></span> : null}
        </button>
      ))}
    </div>
  );
}

export function PlacesSection({ places }: { places: Place[] }) {
  const t = useTranslations('search');
  if (!places.length) return null;
  const screens = places.filter((p) => !p.setting);
  const settings = places.filter((p) => p.setting);
  const list = (items: Place[], title: string) => items.length > 0 && (
    <div>
      <p className={head}>{title}</p>
      <Box>
        {items.map((p) => (
          <Link key={`${p.href}-${p.label}`} href={p.href} className={row}>
            <Emoji e={p.icon} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-extrabold text-ink-900">{p.label}</span>
              <span className="block truncate text-xs text-ink-400">{p.sub}</span>
            </span>
            {p.who !== 'all' && <span className="shrink-0 rounded-pill bg-[#F3E8FF] px-2 py-0.5 text-[11px] font-extrabold text-[#6D28D9]">{t('staffOnly')}</span>}
            <Chev />
          </Link>
        ))}
      </Box>
    </div>
  );
  return <>{list(screens, t('screens'))}{list(settings, t('settings'))}</>;
}

export function RunsSection({ runs, limit }: { runs: RunResults; limit?: number }) {
  const t = useTranslations('search');
  if (!runs.today.length && !runs.runs.length) return null;
  const shown = limit ? runs.runs.slice(0, limit) : runs.runs;
  return (
    <div>
      <p className={head}>{t('runs')}</p>
      <Box>
        {runs.today.map((g) => (
          <Link key={g.title} href={g.href} className={row}>
            <Emoji e="🏃" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-extrabold text-ink-900"><bdi dir="ltr">{g.title}</bdi> · {t('today')}</span>
              <span className="block truncate text-xs text-ink-400">{t('ranToday', { n: g.count })} · <bdi>{g.names.join(', ')}</bdi>{g.count > g.names.length ? <> <bdi dir="ltr">+{g.count - g.names.length}</bdi></> : null}</span>
            </span>
            <Chev />
          </Link>
        ))}
        {shown.map((r) => (
          <Link key={r.id} href={`/dashboard/activities/${r.id}`} className={row}>
            <Emoji e={r.mine ? '⭐' : '🏃'} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-extrabold text-ink-900"><bdi>{r.title}</bdi></span>
              <span className="block truncate text-xs text-ink-400"><bdi>{r.mine ? t('mine') : r.name}</bdi> · <bdi dir="ltr">{dm(r.date)}</bdi> · <bdi dir="ltr">{r.km}</bdi> {t('km')}</span>
            </span>
            <Chev />
          </Link>
        ))}
      </Box>
    </div>
  );
}

/** This week's sessions in my pack that answer the query: by name, headline, or a distance ("1600"). */
export function matchSessions(sessions: WeekSession[] | undefined, q: string): WeekSession[] {
  const s = q.trim().toLowerCase();
  if (s.length < 2 || !sessions) return [];
  const digits = /\d/.test(s);
  return sessions.filter((x) => (x.name || '').toLowerCase().includes(s) || (x.type || '').toLowerCase() === s
    || (digits && JSON.stringify(x.steps || []).includes(s.replace(/\D+/g, ''))));
}

export function PlanSection({ sessions, weekLabel }: { sessions: WeekSession[]; weekLabel: string }) {
  const t = useTranslations('search');
  const tc = useTranslations('common');
  const days = tc.raw('dayNames') as string[];
  if (!sessions.length) return null;
  return (
    <div>
      <p className={head}>{t('inPlan')}</p>
      <Box>
        {sessions.map((x) => (
          <Link key={x.key} href="/dashboard/program" className={row}>
            <Emoji e="📋" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-extrabold text-ink-900">{days[x.dayOfWeek]} · <bdi dir="auto">{x.name}</bdi></span>
              <span className="block truncate text-xs text-ink-400">
                {x.kmMax > 0 && <><bdi dir="ltr">{x.kmMin !== x.kmMax ? `${x.kmMin}–${x.kmMax}` : x.kmMax}</bdi> {t('km')} · </>}{weekLabel} · {t('yourPack')}{x.optional ? ` · ${t('optional')}` : ''}
              </span>
            </span>
            <Chev />
          </Link>
        ))}
      </Box>
    </div>
  );
}

const RECORD_WORDS: Array<[RegExp, string | null]> = [[/5\s*k|5\s*ק/i, '5k'], [/10\s*k|10\s*ק/i, '10k'], [/חצי|half/i, 'hm'], [/מרתון|marathon/i, 'fm'], [/שיא|pr\b|record|שיאים/i, null]];
/** Which of my records the query asks for: one bucket, all of them, or none. */
export function recordBuckets(q: string): string[] | null {
  const hits = RECORD_WORDS.filter(([re]) => re.test(q));
  if (!hits.length) return null;
  const keys = hits.map(([, k]) => k).filter((k): k is string => !!k);
  // "מרתון" alone is also a race name: only with "שיא" or a distance in it is it a record.
  if (!hits.some(([, k]) => k === null) && !/\d/.test(q)) return null;
  return keys.length ? keys : ['5k', '10k', 'hm', 'fm'];
}

export function RecordsSection({ bests, keys, athleteId }: { bests: Array<{ key: string; label: string; seconds: number | null; date: string | null; activityId: string | null }>; keys: string[]; athleteId: string }) {
  const t = useTranslations('search');
  const mine = bests.filter((b) => keys.includes(b.key) && b.seconds);
  if (!mine.length) return null;
  return (
    <div>
      <p className={head}>{t('myRecords')}</p>
      <Box>
        {mine.map((b) => (
          <Link key={b.key} href={b.activityId ? `/dashboard/activities/${b.activityId}` : `${teammateHref(athleteId)}/records`} className={row}>
            <Emoji e="🏅" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-extrabold text-ink-900"><bdi dir="ltr">{b.label}</bdi> · <bdi dir="ltr">{clock(b.seconds!)}</bdi></span>
              {b.date && <span className="block text-xs text-ink-400"><bdi dir="ltr">{dm(String(b.date).slice(0, 10))}.{String(b.date).slice(2, 4)}</bdi></span>}
            </span>
            <Chev />
          </Link>
        ))}
      </Box>
    </div>
  );
}

/** The top person found, and what can be done with them (mockup: "אלון"). */
export function PersonActions({ person, staff, admin }: { person: { id: string; name: string; pack?: string | null; lastRunId?: string | null }; staff: boolean; admin: boolean }) {
  const t = useTranslations('search');
  const first = person.name.trim().split(/\s+/)[0];
  const base = teammateHref(person.id);
  if (!base) return null;
  const items: Array<{ href: string; e: string; label: string; sub?: string; staff?: boolean }> = [
    ...(person.lastRunId ? [{ href: `/dashboard/activities/${person.lastRunId}`, e: '🏃', label: t('lastRun'), sub: t('lastRunSub') }] : []),
    { href: `${base}/records`, e: '🏅', label: t('recordsOf', { name: first }), sub: '5K · 10K · חצי · מרתון' },
    ...(admin ? [{ href: `/dashboard/roles?q=${encodeURIComponent(person.name)}`, e: '🛡️', label: t('rolesOf', { name: first }), sub: t('rolesSub'), staff: true }] : []),
    ...(staff ? [{ href: `/dashboard/people?q=${encodeURIComponent(person.name)}`, e: '👥', label: t('cardOf', { name: first }), sub: t('cardSub'), staff: true }] : []),
  ];
  return (
    <div>
      {/* Not the label style's capitals: a Latin name would come out "ALON". */}
      <p className={cn(head, 'normal-case tracking-normal')}><bdi>{t('ofPerson', { name: first })}</bdi></p>
      <Box>
        {items.map((i) => (
          <Link key={i.href} href={i.href} className={row}>
            <Emoji e={i.e} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-extrabold text-ink-900"><bdi>{i.label}</bdi></span>
              {i.sub && <span className="block truncate text-xs text-ink-400">{i.sub}</span>}
            </span>
            {i.staff && <span className="shrink-0 rounded-pill bg-[#F3E8FF] px-2 py-0.5 text-[11px] font-extrabold text-[#6D28D9]">{t('staffOnly')}</span>}
            <Chev />
          </Link>
        ))}
      </Box>
    </div>
  );
}

// ── recent searches ──────────────────────────────────────────────────────────────

const RECENT_KEY = 'search_recent';
export function readRecent(): string[] {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 5) : []; } catch { return []; }
}
/** Kept when a result is opened — what was searched AND found, the last five. */
export function rememberSearch(q: string) {
  const s = q.trim();
  if (s.length < 2) return;
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([s, ...readRecent().filter((x) => x !== s)].slice(0, 5))); } catch { /* private mode */ }
}

export function RecentSearches({ onPick }: { onPick: (q: string) => void }) {
  const t = useTranslations('search');
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => { setRecent(readRecent()); }, []);
  if (!recent.length) return null;
  return (
    <section>
      <div className="mb-2 flex items-center justify-between px-1">
        <p className="text-xs font-extrabold text-ink-400">{t('recent')}</p>
        <button type="button" onClick={() => { try { localStorage.removeItem(RECENT_KEY); } catch { /* */ } setRecent([]); }} className="min-h-[36px] px-1 text-xs font-bold text-brand-600">{t('clearRecent')}</button>
      </div>
      <Box>
        {recent.map((r) => (
          <button key={r} type="button" onClick={() => onPick(r)} className={cn(row, 'w-full text-start')}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-page"><Clock className="h-4 w-4 text-ink-400" /></span>
            <span className="min-w-0 flex-1 truncate text-[15px] font-bold text-ink-900"><bdi>{r}</bdi></span>
          </button>
        ))}
      </Box>
    </section>
  );
}
