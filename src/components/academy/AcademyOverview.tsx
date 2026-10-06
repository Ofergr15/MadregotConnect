'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Timer, Trophy, Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { Card, EmptyState, SkeletonList } from '@/components/ui';
import { buildFunnel, type CandidateEvent, type CandidateRow } from '@/lib/academy/funnel';
import {
  agoLabel, israelDay, STAGE_SHORT, joinedInMonth, memberTrend, newJoiners, stageBars,
} from '@/lib/academy/overview';
import { BandPaces } from './BandPaces';
import { AcademyTrendChart } from './AcademyTrendChart';
import { joinHebrewList, memberCoachIds, memberCoachNames } from '@/lib/academy/members';
import {
  ATTENTION_ORDER, ATTENTION_STYLE, fmtRate, fmtWeekRange, initialsOf,
  shiftWeek, sundayOf,
  type AcademyMember, type AcademyMembersResponse,
} from './types';

// The manager's landing screen, in the order the questions get asked:
//
//   how many are there → how is the week going → what is waiting on me →
//   the week in numbers → who is new → who is on the way in → who is slipping
//
// It replaced four tiles and three lists that answered "how is the academy" only
// after a visit to three tabs. Everything is still derived from payloads the tabs
// themselves use — the members directory (this week and last) and the joining
// board — so a number here always matches the tab it opens.

const ATTENTION_PREVIEW = 6;
const JOINERS_PREVIEW = 8;
const STUCK_PREVIEW = 3;
/** A joiner wears the "new" tag for their first week. */
const NEW_TAG_DAYS = 7;

type GoTab = 'members' | 'registrations' | 'results' | 'compliance' | 'funnel' | 'settings';

export function AcademyOverview({
  data,
  isLoading,
  weekStart,
  onWeekChange,
  onSelectMember,
  onGoTab,
  onChanged,
  onOpenCoach,
}: {
  data: AcademyMembersResponse | undefined;
  isLoading: boolean;
  weekStart: string;
  onWeekChange: (weekStart: string) => void;
  onSelectMember: (member: AcademyMember) => void;
  onGoTab: (tab: GoTab) => void;
  /** Revalidate the academy payload after a band's paces are edited. */
  onChanged: () => void | Promise<void>;
  /** Open one coach's caseload (the page owns the coaches sheet, next to the ⚙). */
  onOpenCoach?: (coachId: string) => void;
}) {
  const t = useTranslations('academy');
  const locale = useLocale();
  const [now] = useState(() => new Date());
  const [chip, setChip] = useState<Chip | null>(null);
  const today = israelDay(now);

  const isCurrentWeek = weekStart === sundayOf(now);
  const team = data?.team;
  const members = useMemo(() => data?.members ?? [], [data]);
  const isAcademyScope = data?.scope === 'academy';

  // Last week, for the arrows on the numbers. Same route and same cache key shape
  // as the week picker uses, so stepping back a week is usually already loaded.
  const { data: prev } = useApi<AcademyMembersResponse>(
    data ? `/api/academy/members?weekStart=${shiftWeek(weekStart, -1)}${data.scope === 'coach' ? '&scope=coach' : ''}` : null,
  );

  // The joining board is the manager's; a coach's home is their own caseload.
  const { data: funnelRows } = useApi<{ candidates: CandidateRow[]; events: CandidateEvent[] }>(
    isAcademyScope ? '/api/academy/candidates' : null,
  );
  const board = useMemo(
    () => (funnelRows?.candidates
      ? buildFunnel({ candidates: funnelRows.candidates, events: funnelRows.events ?? [], now: now.toISOString() })
      : null),
    [funnelRows, now],
  );

  const trend = useMemo(() => memberTrend(members, weekStart), [members, weekStart]);
  const joinedThisMonth = joinedInMonth(members, today);
  const joinedLastMonth = joinedInMonth(members, today, -1);
  const joiners = useMemo(() => newJoiners(members, today), [members, today]);
  const coachCount = (data?.coaches ?? []).filter(c => c.coachId && c.trainees > 0).length;

  const atRisk = members
    .filter((m) => m.attention.length > 0)
    .map((m) => ({ member: m, worst: Math.min(...m.attention.map((r) => ATTENTION_ORDER.indexOf(r))) }))
    .sort((a, b) => a.worst - b.worst || b.member.attention.length - a.member.attention.length)
    .map((x) => x.member);

  const pending = data?.pending;
  const stuck = board
    ? board.columns.flatMap(c => c.candidates.filter(x => x.stuck).map(x => ({ c: x, spec: c.spec })))
      .sort((a, b) => b.c.daysWaiting - a.c.daysWaiting)
    : [];
  const waitingCount = (pending?.registrations ?? 0) + (pending?.results ?? 0) + stuck.length;

  // ── The home, one screen (2026-10-06) ─────────────────────────────────────
  // Trainees first: four numbers, one chart, the five who most need someone, and
  // a single row of coaches. What used to follow (the sentence, new joiners, the
  // stage chart, a separate attention list) is in the list's chips, the funnel
  // tab, or the chart. Below the fold only what is the manager's work: what is
  // waiting on them, and the bands' paces.
  const approved = members.filter((m) => m.approved);
  const recent = approved.filter((m) => !!m.academyJoinedOn && daysBetween(m.academyJoinedOn, today) <= NEW_DAYS);
  const unpaired = approved.filter((m) => memberCoachIds(m).length === 0);
  const chipCounts = { attention: atRisk.length, unpaired: unpaired.length, recent: recent.length, all: members.length };
  const defaultChip: Chip = atRisk.length ? 'attention' : 'all';
  const shownChip = chip ?? defaultChip;
  const listed = (shownChip === 'attention' ? atRisk
    : shownChip === 'unpaired' ? unpaired
    : shownChip === 'recent' ? [...recent].sort((x, y) => (y.academyJoinedOn || '').localeCompare(x.academyJoinedOn || ''))
    : [...members].sort((x, y) => x.name.localeCompare(y.name))).slice(0, LIST_PREVIEW);
  const coachRow = (data?.coaches ?? []).filter((c) => c.coachId);

  return (
    <div className="space-y-2.5" dir="rtl">
      {isLoading && !data ? (
        <SkeletonList count={5} />
      ) : !team || team.members === 0 ? (
        <EmptyState icon={Users} title={t('noAthletesYet')} description={t('noAthletesDesc')} />
      ) : (
        <>
          {/* 1 · Four numbers. */}
          <div className="grid grid-cols-[1.2fr_1fr_1fr_1fr] overflow-hidden rounded-card bg-card">
            <div className="bg-brand-600 px-1.5 py-2.5 text-center text-white">
              <span className="block text-[22px] font-black leading-tight tabular-nums">{team.approved}</span>
              <span className="block text-3xs opacity-85">{isAcademyScope ? 'מתאמנים' : 'המתאמנים שלי'}</span>
              {joinedThisMonth > 0 && <span className="block text-3xs font-bold opacity-90"><bdi dir="ltr">+{joinedThisMonth}</bdi> החודש</span>}
            </div>
            <Stat label="רצו השבוע" value={<bdi dir="ltr">{team.activeThisWeek}<span className="text-xs font-bold text-ink-400">/{team.approved}</span></bdi>}
              delta={prev ? diffLabel(team.activeThisWeek - prev.team.activeThisWeek, '') : null} />
            <Stat label="בתוכנית" value={fmtRate(team.completionRate)} onClick={() => onGoTab('compliance')}
              delta={prev && team.completionRate !== null && prev.team.completionRate !== null
                ? diffLabel(Math.round((team.completionRate - prev.team.completionRate) * 100), '', '%') : null} />
            {isAcademyScope && board ? (
              <Stat label="במשפך" value={String(board.live)} onClick={() => onGoTab('funnel')}
                note={stuck.length ? `${stuck.length} תקועים` : undefined} />
            ) : (
              <Stat label="ק״מ השבוע" value={team.weekKm.toFixed(0)}
                delta={prev ? diffLabel(Math.round(team.weekKm - prev.team.weekKm), '') : null} />
            )}
          </div>

          {/* 2 · One chart, three ways. */}
          <AcademyTrendChart coachScope={data?.scope === 'coach'} />

          {/* 3 · The trainees: who needs someone, first. */}
          <div className="flex gap-1.5 overflow-x-auto" role="tablist">
            {CHIPS.filter((c) => (c.key !== 'unpaired' || isAcademyScope) && (c.key === 'all' || chipCounts[c.key] > 0)).map((c) => (
              <button
                key={c.key}
                role="tab"
                aria-selected={shownChip === c.key}
                onClick={() => setChip(c.key)}
                className={cn(
                  'min-h-[34px] shrink-0 rounded-pill px-3 text-xs font-semibold',
                  shownChip === c.key ? 'bg-ink-700 text-white' : 'bg-card text-ink-500',
                )}
              >
                {c.label}<span className="ms-1 opacity-60 tabular-nums">{chipCounts[c.key]}</span>
              </button>
            ))}
            <button onClick={() => onGoTab('members')} className="min-h-[34px] shrink-0 px-2 text-xs font-semibold text-brand-600">
              כל ה־{members.length} ›
            </button>
          </div>
          {listed.length === 0 ? (
            <Card variant="muted" className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-accent-600" />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-ink-700">{t('allGood')}</div>
                <div className="text-xs text-ink-400">{t('allGoodDesc')}</div>
              </div>
            </Card>
          ) : (
            <Card className="divide-y divide-page py-0.5">
              {listed.map((m) => <TraineeRow key={m.athleteId} m={m} showCoach={isAcademyScope} onClick={() => onSelectMember(m)} reason={(r) => t(`reason_${r}`)} />)}
            </Card>
          )}

          {/* 4 · The coaches, one row. Each opens their caseload. */}
          {isAcademyScope && coachRow.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              <span className="shrink-0 text-xs font-bold text-ink-400">מאמנים</span>
              {coachRow.map((c) => (
                <button key={c.coachId} onClick={() => onOpenCoach?.(c.coachId!)}
                  className="min-h-[34px] shrink-0 rounded-pill bg-card px-3 text-xs font-semibold text-ink-700" dir="auto">
                  {(c.coachName || '').split(' ')[0]}<span className="ms-1 text-ink-400 tabular-nums">{c.trainees}</span>
                </button>
              ))}
              {unpaired.length > 0 && (
                <button onClick={() => setChip('unpaired')}
                  className="min-h-[34px] shrink-0 rounded-pill bg-band-3/15 px-3 text-xs font-semibold text-band-3-ink">
                  בלי מאמן<span className="ms-1 tabular-nums">{unpaired.length}</span>
                </button>
              )}
            </div>
          )}

          {/* Below the fold: the manager's own work. */}
          {waitingCount > 0 && (
            <div className="pt-3">
              <SectionHeader title="מחכה לך" count={waitingCount} />
              <div className="space-y-2">
                {!!pending?.registrations && isAcademyScope && (
                  <StoryCard icon={ClipboardList} tone="amber" chip="לטיפול" onClick={() => onGoTab('registrations')}
                    title={pending.registrations === 1 ? 'טופס הצטרפות חדש' : `${pending.registrations} טפסי הצטרפות חדשים`}
                    body="השלב הבא: שיחת היכרות" />
                )}
                {!!pending?.results && (
                  <StoryCard icon={Trophy} tone="amber" chip="לאישור" onClick={() => onGoTab('results')}
                    title={t('pendingResults')} body={`${pending.results} ממתינות`} />
                )}
                {stuck.slice(0, STUCK_PREVIEW).map(({ c, spec }) => (
                  <StoryCard key={c.id} icon={Timer} tone="red" chip="תקוע" onClick={() => onGoTab('funnel')}
                    title={c.name} body={`${spec.waiting} · ${c.daysWaiting} ימים`} />
                ))}
              </div>
            </div>
          )}
          {(data?.bands?.length ?? 0) > 0 && (
            <div className="pt-1">
              <BandPaces bands={data!.bands} canEdit={isAcademyScope} onChanged={onChanged} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

type Chip = 'attention' | 'unpaired' | 'recent' | 'all';
const CHIPS: Array<{ key: Chip; label: string }> = [
  { key: 'attention', label: 'תשומת לב' },
  { key: 'unpaired', label: 'בלי מאמן' },
  { key: 'recent', label: 'חדשים' },
  { key: 'all', label: 'הכל' },
];
const LIST_PREVIEW = 5;
const NEW_DAYS = 30;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from.slice(0, 10)}T12:00:00Z`)) / 86_400_000);

function Stat({ label, value, delta, note, onClick }: {
  label: string; value: React.ReactNode; delta?: { text: string; tone: 'up' | 'down' | 'flat' } | null; note?: string; onClick?: () => void;
}) {
  const inner = (
    <>
      <span className="block text-[22px] font-black leading-tight tabular-nums text-ink-700">{value}</span>
      <span className="block text-3xs text-ink-400">{label}</span>
      {delta && delta.tone !== 'flat' && (
        <span className={cn('block text-3xs font-bold', delta.tone === 'up' ? 'text-accent-900' : 'text-accent-red')}>
          <bdi dir="ltr">{delta.text}</bdi>
        </span>
      )}
      {note && <span className="block text-3xs font-bold text-band-3-ink">{note}</span>}
    </>
  );
  const cls = 'border-s border-page px-1 py-2.5 text-center';
  return onClick
    ? <button onClick={onClick} className={cn(cls, 'active:bg-page/60')}>{inner}</button>
    : <div className={cls}>{inner}</div>;
}

function TraineeRow({ m, showCoach, onClick, reason }: {
  m: AcademyMember; showCoach: boolean; onClick: () => void; reason: (r: string) => string;
}) {
  const worst = ATTENTION_ORDER.find((x) => m.attention.includes(x));
  const sub = showCoach
    ? (memberCoachNames(m).filter(Boolean).length ? memberCoachNames(m).filter(Boolean).map((n) => n.split(' ')[0]).join(' · ') : 'בלי מאמן')
    : (m.band?.name ?? 'בלי דבוקה');
  return (
    <button onClick={onClick} className="flex h-[54px] w-full items-center gap-2.5 text-start active:bg-page/60">
      <Avatar member={m} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink-700" dir="auto">{m.name}</span>
        <span className="flex items-center gap-1.5 text-xs text-ink-400">
          <span className="truncate" dir="auto">{sub}</span>
          {m.plannedCount > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-page" aria-hidden>
                <span className="h-full rounded-full bg-brand-600" style={{ width: `${Math.min(100, (100 * m.completedCount) / m.plannedCount)}%` }} />
              </span>
              <bdi dir="ltr" className="tabular-nums">{m.completedCount}/{m.plannedCount}</bdi>
            </>
          )}
        </span>
      </span>
      {worst ? (
        <span className={cn('shrink-0 rounded border px-1.5 py-0.5 text-3xs font-semibold', ATTENTION_STYLE[worst])}>{reason(worst)}</span>
      ) : (
        <span className="shrink-0 text-sm font-bold tabular-nums text-ink-700">{m.weekKm.toFixed(1)} <span className="text-3xs font-normal text-ink-400">ק״מ</span></span>
      )}
    </button>
  );
}

/** "▲ 2 משבוע שעבר", "▼ 38", or "ללא שינוי". */
export function diffLabel(diff: number, suffix: string, unit = ''): { text: string; tone: 'up' | 'down' | 'flat' } {
  if (diff === 0) return { text: 'ללא שינוי', tone: 'flat' };
  const arrow = diff > 0 ? '▲' : '▼';
  return { text: `${arrow} ${Math.abs(diff)}${unit}${suffix ? ` ${suffix}` : ''}`, tone: diff > 0 ? 'up' : 'down' };
}

function attentionLine(m: AcademyMember): string {
  if (m.daysSinceActivity !== null && m.daysSinceActivity >= 7) return `לא רץ/ה ${m.daysSinceActivity} ימים`;
  if (m.plannedCount > 0) return `${m.completedCount} מתוך ${m.plannedCount} אימונים`;
  const names = memberCoachNames(m).filter(Boolean);
  return names.length ? `אצל ${joinHebrewList(names)}` : 'בלי מאמן';
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const W = 320, H = 44, P = 5;
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * W,
    H - P - ((v - min) / span) * (H - 2 * P),
  ]);
  // Drawn left→right as time, like every chart in the app, even in RTL.
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 block h-8 w-full" preserveAspectRatio="none" aria-hidden="true" style={{ direction: 'ltr' }}>
      <polyline fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"
        points={pts.map(p => p.join(',')).join(' ')} vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r={4} fill="currentColor" />
    </svg>
  );
}

function StageChart({ bars, active, onClick }: {
  bars: { key: string; label: string; count: number; stuck: boolean }[];
  active: number;
  onClick: () => void;
}) {
  const max = Math.max(active, ...bars.map(b => b.count), 1);
  const H = 64;
  const col = (key: string, label: string, count: number, cls: string) => (
    <div key={key} className="flex min-w-0 flex-1 flex-col items-center gap-1">
      <b className="text-xs tabular-nums text-ink-700">{count}</b>
      <i className={cn('block w-full rounded-t-md rounded-b-sm', count === 0 ? 'bg-page' : cls)}
        style={{ height: Math.max(3, Math.round((count / max) * H)) }} />
      <span className="w-full truncate text-center text-[9px] text-ink-400">{label}</span>
    </div>
  );
  return (
    <button onClick={onClick} className="block w-full text-start" aria-label="פתיחת לוח המצטרפים">
      <div className="mb-2 text-sm font-bold text-ink-700">באיזה שלב כל אחד</div>
      <div className="flex items-end gap-1">
        {bars.map(b => col(b.key, b.label, b.count, b.stuck ? 'bg-accent-red' : 'bg-brand-600'))}
        {col('active', 'פעילים', active, 'bg-accent-700')}
      </div>
    </button>
  );
}

/** The joining board in a thumbnail: one bar per stage, form on the right as the
 *  board reads, amber where somebody is stuck. The labelled chart is further down. */
function MiniStages({ bars }: { bars: { key: string; count: number; stuck: boolean }[] }) {
  const max = Math.max(...bars.map(b => b.count), 1);
  return (
    <span className="mt-1 flex h-9 items-end gap-[3px]" aria-hidden="true">
      {bars.map(b => (
        <i key={b.key} className={cn('block min-w-0 flex-1 rounded-t-[3px]',
          b.count === 0 ? 'bg-white/20' : b.stuck ? 'bg-amber-300' : 'bg-white')}
          style={{ height: b.count === 0 ? 3 : Math.max(6, Math.round((b.count / max) * 36)) }} />
      ))}
    </span>
  );
}

/**
 * The week the academy home shows, for the page's title row (the home has no row
 * of its own for it, so it fits one screen): "השבוע · 4–10 באוק׳" and its arrows.
 */
export function AcademyWeekLabel({ weekStart }: { weekStart: string }) {
  const t = useTranslations('academy');
  const locale = useLocale();
  const [now] = useState(() => new Date());
  const current = weekStart === sundayOf(now);
  return (
    <span className="block truncate text-xs font-semibold text-ink-400">
      {current ? t('thisWeek') : 'שבוע'} · <bdi dir="ltr">{fmtWeekRange(weekStart, locale)}</bdi>
    </span>
  );
}

export function AcademyWeekArrows({ weekStart, onWeekChange }: { weekStart: string; onWeekChange: (w: string) => void }) {
  const t = useTranslations('academy');
  const [now] = useState(() => new Date());
  return (
    <span className="flex shrink-0 items-center gap-1">
      <WeekArrow label={t('previousWeek')} onClick={() => onWeekChange(shiftWeek(weekStart, -1))} dir="back" />
      <WeekArrow label={t('nextWeek')} onClick={() => onWeekChange(shiftWeek(weekStart, 1))} dir="forward" disabled={weekStart === sundayOf(now)} />
    </span>
  );
}

function WeekArrow({ label, onClick, dir, disabled }: { label: string; onClick: () => void; dir: 'back' | 'forward'; disabled?: boolean }) {
  // RTL: back in time points right.
  const Icon = dir === 'back' ? ChevronRight : ChevronLeft;
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label}
      className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink-500 disabled:opacity-30">
      <Icon className="h-5 w-5" />
    </button>
  );
}

function Avatar({ member, size = 'md' }: { member: AcademyMember; size?: 'md' | 'lg' }) {
  const cls = size === 'lg' ? 'h-12 w-12 text-sm' : 'h-9 w-9 text-xs';
  if (member.avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={member.avatarUrl} alt="" className={cn('shrink-0 rounded-full object-cover', cls)} />;
  }
  return (
    <div className={cn('flex shrink-0 items-center justify-center rounded-full bg-brand-600/20 font-bold text-brand-600', cls)}>
      {initialsOf(member.name)}
    </div>
  );
}

function SectionHeader({ title, count, actionLabel, onAction }: {
  title: string; count?: number; actionLabel?: string; onAction?: () => void;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3 px-1">
      <h2 className="text-sm font-bold text-ink-700">
        {title}
        {count !== undefined && count > 0 && <span className="ms-1.5 font-semibold text-ink-400">{count}</span>}
      </h2>
      {actionLabel && onAction && (
        <button onClick={onAction} className="-mx-1 -my-1.5 min-h-[44px] px-2 text-xs font-semibold text-brand-600">
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function Tile({ label, value, delta, onClick }: {
  label: string; value: string; delta: { text: string; tone: 'up' | 'down' | 'flat' } | null; onClick?: () => void;
}) {
  const inner = (
    <>
      <div className="text-3xs font-semibold text-ink-400">{label}</div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xl font-bold leading-tight tabular-nums text-ink-700">{value}</span>
        {delta && (
          <span className={cn('truncate text-3xs font-bold',
            delta.tone === 'up' ? 'text-accent-700' : delta.tone === 'down' ? 'text-accent-red' : 'text-ink-400')}>
            {delta.text}
          </span>
        )}
      </div>
    </>
  );
  return onClick
    ? <button onClick={onClick} className="rounded-card bg-card px-3 py-2 text-start active:scale-[0.98] transition-transform">{inner}</button>
    : <div className="rounded-card bg-card px-3 py-2">{inner}</div>;
}

function StoryCard({ icon: Icon, tone, title, body, chip, onClick }: {
  icon: React.ComponentType<{ className?: string }>;
  tone: 'amber' | 'red';
  title: string; body: string; chip: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className="flex w-full min-h-[60px] items-center gap-3 rounded-card bg-card p-3.5 text-start active:scale-[0.99] transition-transform">
      <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
        tone === 'red' ? 'bg-accent-red/10' : 'bg-band-3/15')}>
        {tone === 'red' ? <AlertTriangle className="h-4 w-4 text-accent-red" /> : <Icon className="h-4 w-4 text-band-3-ink" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold text-ink-700">{title}</span>
        <span className="block truncate text-xs text-ink-400">{body}</span>
      </span>
      <span className={cn('shrink-0 rounded-lg px-2 py-0.5 text-3xs font-bold',
        tone === 'red' ? 'bg-accent-red/10 text-accent-red' : 'bg-band-3/15 text-band-3-ink')}>{chip}</span>
    </button>
  );
}
