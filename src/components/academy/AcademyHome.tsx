'use client';

import { useMemo, useState } from 'react';
import {
  ArrowLeftRight, ClipboardList, MessageSquare, Plus, Sparkles, Timer, Trophy, TrendingUp, UserPlus, Users, Watch,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmptyState, SkeletonList } from '@/components/ui';
import {
  ageLabel, initialsLine, weekSquares,
  type AcademyHomeResponse, type GrowthWeek, type WaitingItem, type WaitingKind,
} from '@/lib/academy/home';
import type { Suggestion } from '@/lib/academy/suggestions';
import type { AcademyMembersResponse } from './types';
import { memberCoachIds } from '@/lib/academy/members';

// The academy home, as phone 1 of the approved mockup (academy-manager-v5.html)
// draws it, top to bottom:
//
//   growth card   how many are in the academy, week after week: who was there
//                 (dark), who joined that week (light), a red dot where someone left
//   this week     three squares — on plan · behind · didn't run
//   suggestion    the one smart next step, with its ⋯
//   quick actions trainee · coach for a trainee · coach
//   waiting       "מחכה לך", most urgent first, one button each
//
// Presentational: the shell (AcademyShell) owns the fetches, the suggestion and
// the waiting list, so the badges on the areas bar and the rows here are the
// same numbers.

export type SquareKey = 'onPlan' | 'behind' | 'notRun';
export type QuickKey = 'add' | 'move' | 'coach';

const VIOLET = '#5B21D6';

export function AcademyHome({
  data, isLoading, prev, home, waiting, suggestion, suggestionBusy, capacity, isManager,
  onSquare, onSuggestion, onSuggestionMore, onQuick, onWaiting,
}: {
  data: AcademyMembersResponse | undefined;
  isLoading: boolean;
  /** Last week's payload, for the arrow on the plan percentage. */
  prev: AcademyMembersResponse | undefined;
  home: AcademyHomeResponse | undefined;
  waiting: WaitingItem[];
  suggestion: Suggestion | null;
  suggestionBusy?: boolean;
  capacity: number;
  isManager: boolean;
  onSquare: (key: SquareKey) => void;
  onSuggestion: (s: Suggestion) => void;
  onSuggestionMore: (s: Suggestion) => void;
  onQuick: (key: QuickKey) => void;
  onWaiting: (item: WaitingItem) => void;
}) {
  const [allWaiting, setAllWaiting] = useState(false);
  const members = useMemo(() => data?.members ?? [], [data]);
  const squares = useMemo(() => weekSquares(members), [members]);

  if (isLoading && !data) return <SkeletonList count={5} />;
  if (!data || data.team.members === 0) {
    return <EmptyState icon={Users} title="עוד אין מתאמנים באקדמיה" description="מוסיפים מתאמן מהמועדון או שולחים טופס הרשמה" />;
  }

  const approved = members.filter((m) => m.approved);
  const unpaired = approved.filter((m) => memberCoachIds(m).length === 0).length;
  const coachRows = (data.coaches ?? []).filter((c) => c.coachId);
  const rate = data.team.completionRate;
  const prevRate = prev?.team.completionRate ?? null;
  const rateDiff = rate !== null && prevRate !== null ? Math.round((rate - prevRate) * 100) : null;
  const shownWaiting = allWaiting ? waiting : waiting.slice(0, 3);

  return (
    <div className="space-y-2.5" dir="rtl">
      {/* 1 · Growth */}
      <section className="rounded-card bg-card px-3 pb-2.5 pt-3" aria-label="מתאמנים באקדמיה">
        <div className="flex items-end justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <b className="text-[32px] font-black leading-none tracking-tight tabular-nums text-ink-700">{approved.length}</b>
            <span className="text-[13px] font-extrabold text-ink-500">{isManager ? 'מתאמנים באקדמיה' : 'המתאמנים שלי'}</span>
          </div>
          <div className="flex shrink-0 gap-1.5">
            {!!home?.month.joined && (
              <span className="rounded-pill bg-accent-600/15 px-2 py-0.5 text-2xs font-black text-accent-900">
                ▲ <bdi dir="ltr">{home.month.joined}</bdi> החודש
              </span>
            )}
            {!!home?.month.left && (
              <span className="rounded-pill bg-accent-red/10 px-2 py-0.5 text-2xs font-black text-accent-red-ink">
                <bdi dir="ltr">{home.month.left}</bdi> {home.month.left === 1 ? 'עזב' : 'עזבו'}
              </span>
            )}
          </div>
        </div>
        <GrowthChart weeks={home?.weeks ?? []} />
        <div className="mt-0.5 flex gap-3 text-3xs font-bold text-ink-400">
          <span><i className="me-1 inline-block h-[9px] w-[9px] rounded-[3px] bg-brand-600 align-[-1px]" />היו כבר</span>
          <span><i className="me-1 inline-block h-[9px] w-[9px] rounded-[3px] bg-[#9FA8FF] align-[-1px]" />הצטרפו באותו שבוע</span>
          <span><i className="me-1 inline-block h-[9px] w-[9px] rounded-full bg-[#E5484D] align-[-1px]" />מישהו עזב</span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {isManager ? (
            <>
              <Mini value={coachRows.length} label="מאמנים" />
              <Mini value={unpaired} label="בלי מאמן" tone={unpaired ? 'slow' : undefined} />
              <Mini value={home?.funnel?.live ?? '—'} label="בדרך פנימה" tone="violet" />
            </>
          ) : (
            <>
              <Mini value={<bdi dir="ltr">{data.team.activeThisWeek}/{approved.length}</bdi>} label="רצו השבוע" />
              <Mini value={Math.round(data.team.weekKm)} label="ק״מ השבוע" />
              <Mini value={Math.max(0, capacity - approved.length)} label="מקומות פנויים" tone="violet" />
            </>
          )}
        </div>
      </section>

      {/* 2 · This week, three squares */}
      <section className="rounded-card bg-card p-3" aria-label="השבוע באקדמיה">
        <div className="mb-2 flex items-baseline justify-between px-0.5">
          <b className="text-[15px] font-black text-ink-700">השבוע באקדמיה</b>
          {rate !== null && (
            <span className="text-xs font-bold text-ink-400">
              <bdi dir="ltr">{Math.round(rate * 100)}%</bdi> מהתוכנית
              {rateDiff !== null && rateDiff !== 0 && (
                <> · <span className={rateDiff > 0 ? 'text-accent-900' : 'text-accent-red-ink'}>{rateDiff > 0 ? '▲' : '▼'} <bdi dir="ltr">{Math.abs(rateDiff)}%</bdi></span></>
              )}
            </span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-[7px]">
          <Square tone="good" n={squares.onPlan.length} label="בתוכנית" names={squares.onPlan.map((m) => m.name)} onClick={() => onSquare('onPlan')} />
          <Square tone="slow" n={squares.behind.length} label="מאחור" names={squares.behind.map((m) => m.name)} onClick={() => onSquare('behind')} />
          <Square tone="bad" n={squares.notRun.length} label="לא רצו" names={squares.notRun.map((m) => m.name)} onClick={() => onSquare('notRun')} />
        </div>
      </section>

      {/* 3 · The smart suggestion */}
      {suggestion && (
        <section className="flex items-center gap-2.5 rounded-card border-[1.5px] border-[#D9D2FF] bg-gradient-to-br from-[#F2EDFF] to-[#E9ECFF] py-2 pe-2 ps-3" aria-label="הצעה">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-card" style={{ color: VIOLET }}>
            <Sparkles className="h-[18px] w-[18px]" />
          </span>
          <span className="min-w-0 flex-1">
            <b className="block text-[13.5px] font-black leading-tight text-ink-700" dir="auto">{suggestion.title}</b>
            <small className="block truncate text-2xs text-ink-500" dir="auto">{suggestion.sub}</small>
          </span>
          <button
            type="button"
            onClick={() => onSuggestion(suggestion)}
            disabled={suggestionBusy}
            className="min-h-[44px] shrink-0 rounded-xl px-3 text-[12.5px] font-extrabold text-white disabled:opacity-60"
            style={{ background: VIOLET }}
          >
            {suggestionBusy ? '…' : suggestion.primary}
          </button>
          <button
            type="button"
            onClick={() => onSuggestionMore(suggestion)}
            aria-label="עוד אפשרויות להצעה"
            className="grid h-11 w-9 shrink-0 place-items-center rounded-xl bg-card text-lg font-black leading-none"
            style={{ color: VIOLET }}
          >
            ⋯
          </button>
        </section>
      )}

      {/* 4 · Quick actions */}
      {/* The roster is the manager's to change; a coach's home has no such row. */}
      {isManager && (
        <div className="flex gap-1.5">
          <QuickButton icon={Plus} bg="bg-brand-600" label="מתאמן" onClick={() => onQuick('add')} />
          <QuickButton icon={ArrowLeftRight} bg="bg-accent-700" label="מאמן למתאמן" onClick={() => onQuick('move')} />
          <QuickButton icon={UserPlus} bgStyle={VIOLET} label="מאמן" onClick={() => onQuick('coach')} />
        </div>
      )}

      {/* 5 · Waiting for you */}
      {waiting.length > 0 && (
        <>
          <div className="mx-1 -mb-0.5 mt-0.5 flex items-baseline justify-between">
            <b className="text-[15px] font-black text-ink-700">מחכה לך · <bdi dir="ltr">{waiting.length}</bdi></b>
            {waiting.length > 3 && (
              <button type="button" onClick={() => setAllWaiting((v) => !v)} className="-my-3 min-h-[44px] px-1 text-xs font-extrabold text-brand-600">
                {allWaiting ? 'פחות' : 'הכל'}
              </button>
            )}
          </div>
          <div className="overflow-hidden rounded-card bg-card">
            {shownWaiting.map((w) => <WaitingRow key={w.key} item={w} onClick={() => onWaiting(w)} />)}
          </div>
        </>
      )}
    </div>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function Mini({ value, label, tone }: { value: React.ReactNode; label: string; tone?: 'slow' | 'violet' }) {
  return (
    <div className="flex items-baseline justify-center gap-1.5 rounded-xl bg-page/60 px-2 py-1.5">
      <b className={cn('text-base font-black tabular-nums', tone === 'slow' ? 'text-band-3-ink' : 'text-ink-700')} style={tone === 'violet' ? { color: VIOLET } : undefined}>{value}</b>
      <span className="truncate text-2xs font-extrabold text-ink-500">{label}</span>
    </div>
  );
}

const SQUARE_TONE = {
  good: 'bg-accent-600/15 text-accent-900',
  slow: 'bg-band-3/15 text-band-3-ink',
  bad: 'bg-accent-red/10 text-accent-red-ink',
} as const;

function Square({ tone, n, label, names, onClick }: {
  tone: keyof typeof SQUARE_TONE; n: number; label: string; names: string[]; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} disabled={n === 0}
      className={cn('min-h-[76px] rounded-2xl px-2 pb-2 pt-2.5 text-center transition-transform active:scale-[0.98] disabled:active:scale-100', SQUARE_TONE[tone])}>
      <b className="block text-[26px] font-black leading-none tabular-nums">{n}</b>
      <span className="mt-0.5 block text-2xs font-extrabold">{label}</span>
      <small className="mt-1 block truncate text-3xs opacity-80" dir="ltr">{n ? initialsLine(names) : '—'}</small>
    </button>
  );
}

function QuickButton({ icon: Icon, bg, bgStyle, label, onClick }: {
  icon: React.ComponentType<{ className?: string }>; bg?: string; bgStyle?: string; label: string; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick}
      className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-2xl bg-card text-[12.5px] font-extrabold text-ink-700 active:bg-page/60">
      <span className={cn('grid h-6 w-6 place-items-center rounded-lg text-white', bg)} style={bgStyle ? { background: bgStyle } : undefined}>
        <Icon className="h-[15px] w-[15px]" />
      </span>
      {label}
    </button>
  );
}

const WAITING_ICON: Record<WaitingKind, { icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  threads: { icon: MessageSquare, cls: 'bg-brand-600/10 text-brand-600' },
  dispatch: { icon: Watch, cls: 'bg-accent-red/10 text-accent-red' },
  form: { icon: ClipboardList, cls: 'bg-accent-600/15 text-accent-900' },
  registrations: { icon: ClipboardList, cls: 'bg-accent-600/15 text-accent-900' },
  stuck: { icon: Timer, cls: 'bg-band-3/15 text-band-3-ink' },
  approvals: { icon: TrendingUp, cls: 'bg-band-3/15 text-band-3-ink' },
  results: { icon: Trophy, cls: 'bg-band-3/15 text-band-3-ink' },
};

function WaitingRow({ item, onClick }: { item: WaitingItem; onClick: () => void }) {
  const { icon: Icon, cls } = WAITING_ICON[item.kind];
  const age = ageLabel(item.ageHours);
  return (
    <button type="button" onClick={onClick}
      className="flex h-[58px] w-full items-center gap-2.5 border-b border-page/70 px-3 text-start last:border-0 active:bg-page/40">
      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', cls)}><Icon className="h-[18px] w-[18px]" /></span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <b className="truncate text-sm font-extrabold text-ink-700" dir="auto">{item.title}</b>
          {age && <bdi className="shrink-0 rounded-md bg-page/70 px-1.5 text-3xs font-extrabold text-ink-400">{age}</bdi>}
        </span>
        <small className="block truncate text-2xs text-ink-400" dir="auto">{item.sub}</small>
      </span>
      <span className="shrink-0 rounded-xl bg-brand-600/10 px-3 py-2 text-[12.5px] font-extrabold text-brand-600">{item.action}</span>
    </button>
  );
}

// ── The growth chart ────────────────────────────────────────────────────────

const MONTH = new Intl.DateTimeFormat('he', { month: 'short', timeZone: 'UTC' });
const fmtDay = (iso: string) => { const [, m, d] = iso.split('-').map(Number); return `${d}.${m}`; };

/**
 * Twelve weeks as stacked bars, time running left to right like every chart in
 * the app (so the SVG is LTR even in an RTL page). A tap on a bar names that week.
 */
export function GrowthChart({ weeks }: { weeks: GrowthWeek[] }) {
  const [picked, setPicked] = useState<number | null>(null);
  const W = 334, H = 96, TOP = 14, BASE = 78;
  const n = weeks.length;
  if (!n) return <div className="mt-2 h-[96px] animate-pulse rounded-xl bg-page/50" />;
  const max = Math.max(1, ...weeks.map((w) => w.trainees));
  const slot = W / n;
  const bw = Math.min(20, slot - 8);
  const scale = (v: number) => (v / max) * (BASE - TOP - 8);
  const labels = new Set<number>([0, n - 1]);
  for (let i = 1; i < n - 1; i++) {
    if (weeks[i].weekStart.slice(5, 7) !== weeks[i - 1].weekStart.slice(5, 7) && i > 2 && i < n - 3) labels.add(i);
  }
  const p = picked !== null ? weeks[picked] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 block w-full overflow-visible" style={{ direction: 'ltr' }} role="img"
        aria-label={`מתאמנים לפי שבוע, ${weeks[0].trainees} לפני ${n} שבועות ו־${weeks[n - 1].trainees} השבוע`}>
        {[BASE, (BASE + TOP) / 2, TOP].map((y) => <line key={y} x1={0} x2={W} y1={y} y2={y} stroke="#EEEEF3" />)}
        {weeks.map((w, i) => {
          const x = i * slot + (slot - bw) / 2;
          const hE = scale(w.existing);
          const hJ = scale(w.joined);
          const on = picked === i;
          return (
            <g key={w.weekStart} onClick={() => setPicked(on ? null : i)} style={{ cursor: 'pointer' }} opacity={picked === null || on ? 1 : 0.45}>
              <rect x={i * slot} y={0} width={slot} height={H} fill="transparent" />
              {hE > 0 && <rect x={x} y={BASE - hE} width={bw} height={hE} rx={hJ > 0 ? 2 : 4} fill="#1525FF" />}
              {hJ > 0 && <rect x={x} y={BASE - hE - hJ - (hE > 0 ? 2 : 0)} width={bw} height={hJ} rx={4} fill="#9FA8FF" />}
              {w.left > 0 && <circle cx={x + bw / 2} cy={85} r={3.2} fill="#E5484D" />}
              {i === n - 1 && (
                <text x={x + bw / 2} y={BASE - hE - hJ - 6} textAnchor="middle" style={{ fontSize: 11, fontWeight: 900, fill: '#1F2030' }}>{w.trainees}</text>
              )}
              {labels.has(i) && (
                <text x={x + bw / 2} y={95} textAnchor="middle" style={{ fontSize: 9.5, fill: '#5F5F5F' }}>
                  {i === n - 1 ? 'השבוע' : MONTH.format(new Date(`${w.weekStart}T12:00:00Z`))}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {p && (
        <div className="pointer-events-none absolute inset-x-0 top-0 mx-auto w-fit rounded-pill bg-ink-700 px-2.5 py-1 text-2xs font-bold text-white">
          שבוע <bdi dir="ltr">{fmtDay(p.weekStart)}</bdi> · <bdi dir="ltr">{p.trainees}</bdi> מתאמנים
          {p.joined > 0 && <> · <bdi dir="ltr">+{p.joined}</bdi></>}
          {p.left > 0 && <> · <bdi dir="ltr">{p.left}</bdi> עזב</>}
        </div>
      )}
    </div>
  );
}
