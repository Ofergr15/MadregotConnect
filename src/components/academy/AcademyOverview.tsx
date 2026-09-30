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

type GoTab = 'members' | 'registrations' | 'results' | 'compliance' | 'funnel';

export function AcademyOverview({
  data,
  isLoading,
  weekStart,
  onWeekChange,
  onSelectMember,
  onGoTab,
  onChanged,
}: {
  data: AcademyMembersResponse | undefined;
  isLoading: boolean;
  weekStart: string;
  onWeekChange: (weekStart: string) => void;
  onSelectMember: (member: AcademyMember) => void;
  onGoTab: (tab: GoTab) => void;
  /** Revalidate the academy payload after a band's paces are edited. */
  onChanged: () => void | Promise<void>;
}) {
  const t = useTranslations('academy');
  const locale = useLocale();
  const [now] = useState(() => new Date());
  const today = israelDay(now);

  const isCurrentWeek = weekStart === sundayOf(now);
  const team = data?.team;
  const members = useMemo(() => data?.members ?? [], [data]);
  const isAcademyScope = data?.scope === 'academy';

  // Last week, for the arrows on the numbers. Same route and same cache key shape
  // as the week picker uses, so stepping back a week is usually already loaded.
  const { data: prev } = useApi<AcademyMembersResponse>(
    data ? `/api/academy/members?weekStart=${shiftWeek(weekStart, -1)}` : null,
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

  return (
    <div className="space-y-5" dir="rtl">
      {/* The first screen, no scrolling: the week, the two charts and the four
          numbers. Everything after the tiles is detail you scroll down to. The page
          title above already says where you are, so there is no greeting line. */}
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="min-w-0 text-sm font-bold text-ink-700">
          {isCurrentWeek ? t('thisWeek') : 'שבוע'} · <bdi dir="ltr" className="font-semibold text-ink-400">{fmtWeekRange(weekStart, locale)}</bdi>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <WeekArrow label={t('previousWeek')} onClick={() => onWeekChange(shiftWeek(weekStart, -1))} dir="back" />
          <WeekArrow label={t('nextWeek')} onClick={() => onWeekChange(shiftWeek(weekStart, 1))} dir="forward" disabled={isCurrentWeek} />
        </div>
      </div>

      {isLoading && !data ? (
        <SkeletonList count={5} />
      ) : !team || team.members === 0 ? (
        <EmptyState icon={Users} title={t('noAthletesYet')} description={t('noAthletesDesc')} />
      ) : (
        <>
          <div className="-mt-2 space-y-2.5">
            {/* 1 · How many, which way it is going, and (manager) who is on the way in. */}
            <div className="flex gap-3 rounded-card bg-brand-600 p-4 text-white">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold opacity-80">{isAcademyScope ? 'מתאמנים באקדמיה' : 'המתאמנים שלי'}</div>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-extrabold leading-tight tabular-nums">{team.members}</span>
                  {joinedThisMonth > 0 && (
                    <span className="text-xs opacity-85"><bdi dir="ltr">+{joinedThisMonth}</bdi> החודש</span>
                  )}
                </div>
                <Sparkline values={trend} />
                {/* Time runs left to right, like the line itself. */}
                <div dir="ltr" className="flex justify-between text-3xs opacity-70">
                  <span>לפני {trend.length} ש׳</span><span>{isCurrentWeek ? 'היום' : 'סוף השבוע'}</span>
                </div>
              </div>
              {board && board.live > 0 && (
                <button onClick={() => onGoTab('funnel')} aria-label="פתיחת לוח המצטרפים"
                  className="flex w-[44%] shrink-0 flex-col border-s border-white/20 ps-3 text-start">
                  <span className="text-xs font-bold opacity-80">בתהליך הצטרפות</span>
                  <span className="flex items-baseline gap-1.5">
                    <span className="text-4xl font-extrabold leading-tight tabular-nums">{board.live}</span>
                    {stuck.length > 0 && <span className="text-xs font-bold text-amber-200">{stuck.length} תקועים</span>}
                  </span>
                  <MiniStages bars={stageBars(board)} />
                  <span dir="ltr" className="flex justify-between text-3xs opacity-70">
                    <span>{STAGE_SHORT.standing_order}</span><span>{STAGE_SHORT.form}</span>
                  </span>
                </button>
              )}
            </div>

            {/* 2 · The week in numbers, each against last week. */}
            <div className="grid grid-cols-2 gap-2.5">
              <Tile label="רצו השבוע" value={`${team.activeThisWeek}/${team.members}`}
                delta={prev ? diffLabel(team.activeThisWeek - prev.team.activeThisWeek, '') : null} />
              <Tile label="ביצוע תוכנית" value={fmtRate(team.completionRate)}
                delta={prev && team.completionRate !== null && prev.team.completionRate !== null
                  ? diffLabel(Math.round((team.completionRate - prev.team.completionRate) * 100), '', '%')
                  : null}
                onClick={() => onGoTab('compliance')} />
              <Tile label="ק״מ השבוע" value={team.weekKm.toFixed(0)}
                delta={prev ? diffLabel(Math.round(team.weekKm - prev.team.weekKm), '') : null} />
              <Tile label="הצטרפו החודש" value={String(joinedThisMonth)}
                delta={diffLabel(joinedThisMonth - joinedLastMonth, '')} />
            </div>
          </div>

          {/* 3 · The week in one sentence — the first thing below the fold. */}
          <Card className="text-base leading-relaxed text-ink-700">
            {isAcademyScope && coachCount > 0 && <><b className="tabular-nums">{team.members}</b> מתאמנים אצל <b className="tabular-nums">{coachCount}</b> מאמנים. </>}
            {isCurrentWeek ? 'השבוע ' : 'באותו שבוע '}
            <b className="tabular-nums">{team.activeThisWeek} מתוך {team.members}</b> רצו
            {team.completionRate !== null && <> וביצעו <b className="tabular-nums">{fmtRate(team.completionRate)}</b> מהתוכנית</>}
            .
            {joinedThisMonth > 0 && (
              <> <span className="rounded-md bg-brand-600/10 px-1 font-bold text-brand-600">{joinedThisMonth} הצטרפו החודש</span>.</>
            )}
            {waitingCount > 0 && <> <b>{waitingCount === 1 ? 'דבר אחד' : `${waitingCount} דברים`}</b> {waitingCount === 1 ? 'מחכה' : 'מחכים'} לך.</>}
          </Card>

          {/* 4 · What is waiting on me. Hidden when empty — a permanent "0" is noise. */}
          {waitingCount > 0 && (
            <div>
              <SectionHeader title="מחכה לך" count={waitingCount} />
              <div className="space-y-2">
                {!!pending?.registrations && (
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

          {/* 5 · Who is new. */}
          {joiners.length > 0 && (
            <div>
              <SectionHeader title="מצטרפים חדשים" actionLabel={t('seeAll')} onAction={() => onGoTab('members')} />
              <Card className="flex gap-3 overflow-x-auto py-3">
                {joiners.slice(0, JOINERS_PREVIEW).map(({ member, daysAgo }) => (
                  <button key={member.athleteId} onClick={() => onSelectMember(member)}
                    className="flex min-w-[64px] flex-col items-center gap-1 text-3xs text-ink-700">
                    <span className="relative">
                      <Avatar member={member} size="lg" />
                      {daysAgo <= NEW_TAG_DAYS && (
                        <span className="absolute -bottom-1 -start-1 rounded-full border-2 border-card bg-accent-700 px-1 text-[9px] font-bold text-white">חדש</span>
                      )}
                    </span>
                    <span className="max-w-[64px] truncate font-semibold">{member.name.split(' ')[0]}</span>
                    <span className="text-ink-400">{agoLabel(daysAgo)}</span>
                  </button>
                ))}
              </Card>
            </div>
          )}

          {/* 6 · Who is on the way in, and where they are stuck. Manager only. */}
          {board && board.live > 0 && (
            <div>
              <SectionHeader title="בתהליך הצטרפות" actionLabel="כל הלוח" onAction={() => onGoTab('funnel')} />
              <Card>
                <StageChart bars={stageBars(board)} active={team.members} onClick={() => onGoTab('funnel')} />
              </Card>
            </div>
          )}

          {/* 7 · Who is slipping. */}
          <div>
            <SectionHeader
              title={t('needsAttention')}
              count={atRisk.length}
              actionLabel={atRisk.length > ATTENTION_PREVIEW ? t('seeAll') : undefined}
              onAction={() => onGoTab('members')}
            />
            {atRisk.length === 0 ? (
              <Card variant="muted" className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-accent-600 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink-700">{t('allGood')}</div>
                  <div className="text-xs text-ink-400">{t('allGoodDesc')}</div>
                </div>
              </Card>
            ) : (
              <Card className="divide-y divide-page py-1">
                {atRisk.slice(0, ATTENTION_PREVIEW).map((m) => (
                  <button key={m.athleteId} onClick={() => onSelectMember(m)}
                    className="flex w-full min-h-[52px] items-center gap-3 py-2.5 text-start">
                    <Avatar member={m} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-ink-700">{m.name}</div>
                      <div className="text-xs text-ink-400">{attentionLine(m)}</div>
                    </div>
                    {(() => {
                      const r = ATTENTION_ORDER.find((x) => m.attention.includes(x))!;
                      return <span className={cn('shrink-0 rounded border px-1.5 py-0.5 text-3xs font-semibold', ATTENTION_STYLE[r])}>{t(`reason_${r}`)}</span>;
                    })()}
                  </button>
                ))}
              </Card>
            )}
          </div>

          {/* A coach's home ends on their whole caseload: with a handful of 1:1
              trainees the list IS the dashboard, and the directory is a tab away. */}
          {!isAcademyScope && (
            <div>
              <SectionHeader title="כל המתאמנים שלי" count={members.length} actionLabel={t('seeAll')} onAction={() => onGoTab('members')} />
              <Card className="divide-y divide-page py-1">
                {[...members].sort((x, y) => x.name.localeCompare(y.name)).map((m) => (
                  <button key={m.athleteId} onClick={() => onSelectMember(m)}
                    className="flex w-full min-h-[52px] items-center gap-3 py-2.5 text-start">
                    <Avatar member={m} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-ink-700">{m.name}</div>
                      <div className="text-xs text-ink-400">
                        {m.band?.name ?? 'בלי דבוקה'} · {m.weekRuns} ריצות השבוע
                      </div>
                    </div>
                    <div className="shrink-0 text-end">
                      <div className="text-sm font-bold tabular-nums text-ink-700">{m.weekKm.toFixed(1)}</div>
                      <div className="text-3xs text-ink-400">{fmtRate(m.completionRate)}</div>
                    </div>
                  </button>
                ))}
              </Card>
            </div>
          )}

          {/* The bands' paces stay on the manager's home: an unpriced band blocks the
              planner, which is work waiting on the manager, not a statistic. */}
          {(data?.bands?.length ?? 0) > 0 && (
            <BandPaces bands={data!.bands} canEdit={isAcademyScope} onChanged={onChanged} />
          )}
        </>
      )}
    </div>
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
  return m.academyCoachName ? `אצל ${m.academyCoachName}` : 'בלי מאמן';
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
