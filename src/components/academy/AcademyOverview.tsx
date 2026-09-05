'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  Activity, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, Layers,
  Route, Trophy, UserPlus, Users, Watch,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, EmptyState, SkeletonList } from '@/components/ui';
import { BandPaces } from './BandPaces';
import {
  ATTENTION_ORDER, ATTENTION_STYLE, fmtRate, fmtWeekRange, initialsOf, rateColor,
  shiftWeek, sundayOf,
  type AcademyMember, type AcademyMembersResponse,
} from './types';

// The manager's landing screen: one answer per question a person running an
// academy actually opens the app to ask — how big is it, is it training, who is
// slipping, and what is waiting on me.
//
// The old academy screen opened on a bare roster behind a seven-item scrolling
// tab strip, so "is the academy healthy this week?" required visiting three tabs
// and joining them by eye. Everything here comes from the single
// /api/academy/members payload, so the overview and the directory can't disagree.

/** How many at-risk members the overview lists before deferring to the directory. */
const ATTENTION_PREVIEW = 6;
/** How many names the "top this week" board shows. */
const TOP_PREVIEW = 5;

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
  onGoTab: (tab: 'members' | 'registrations' | 'results' | 'compliance') => void;
  /** Revalidate the academy payload after a band's paces are edited. */
  onChanged: () => void | Promise<void>;
}) {
  const t = useTranslations('academy');
  const locale = useLocale();

  const isCurrentWeek = weekStart === sundayOf(new Date());
  const team = data?.team;
  const members = data?.members ?? [];

  // Severity order, so the six shown are the six worst — not the six that
  // happened to sort highest by distance.
  const atRisk = members
    .filter((m) => m.attention.length > 0)
    .map((m) => ({
      member: m,
      worst: Math.min(...m.attention.map((r) => ATTENTION_ORDER.indexOf(r))),
    }))
    .sort((a, b) => a.worst - b.worst || b.member.attention.length - a.member.attention.length)
    .map((x) => x.member);

  const top = [...members].filter((m) => m.weekKm > 0).slice(0, TOP_PREVIEW);
  const pending = data?.pending;

  return (
    <div className="space-y-5" dir="auto">
      {/* Week picker — the overview and the compliance tab describe the same week,
          so it has to be steerable from here too. */}
      <div className="flex items-center justify-center gap-2">
        <button
          onClick={() => onWeekChange(shiftWeek(weekStart, -1))}
          className="p-2.5 min-h-[44px] min-w-[44px] rounded-lg text-ink-400 hover:text-ink-900 hover:bg-page transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
          aria-label={t('previousWeek')}
        >
          <ChevronRight className="h-5 w-5 rtl:block hidden" />
          <ChevronLeft className="h-5 w-5 rtl:hidden" />
        </button>
        <div className="text-center min-w-[170px]">
          <div className="text-sm font-semibold text-ink-700">{fmtWeekRange(weekStart, locale)}</div>
          <div className="text-xs text-ink-400">{isCurrentWeek ? t('thisWeek') : ''}</div>
        </div>
        <button
          onClick={() => onWeekChange(shiftWeek(weekStart, 1))}
          disabled={isCurrentWeek}
          className="p-2.5 min-h-[44px] min-w-[44px] rounded-lg text-ink-400 hover:text-ink-900 hover:bg-page transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label={t('nextWeek')}
        >
          <ChevronLeft className="h-5 w-5 rtl:block hidden" />
          <ChevronRight className="h-5 w-5 rtl:hidden" />
        </button>
      </div>

      {isLoading && !data ? (
        <SkeletonList count={5} />
      ) : !team || team.members === 0 ? (
        <EmptyState
          icon={Users}
          title={t('noAthletesYet')}
          description={t('noAthletesDesc')}
        />
      ) : (
        <>
          {/* Headline four. Deliberately not eight: these are the numbers a
              manager quotes, everything else is a drill-in. */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <Tile icon={Users} label={t('statMembers')} value={String(team.members)} />
            <Tile
              icon={Activity}
              label={t('statActiveThisWeek')}
              value={`${team.activeThisWeek}/${team.members}`}
              valueClass={team.activeThisWeek === 0 ? 'text-accent-red' : undefined}
            />
            <Tile icon={Route} label={t('statAcademyKm')} value={team.weekKm.toFixed(1)} />
            <Tile
              icon={Trophy}
              label={t('statAdherence')}
              value={fmtRate(team.completionRate)}
              valueClass={rateColor(team.completionRate)}
            />
          </div>

          {/* Inbox: things waiting on a decision. Hidden entirely when empty —
              a permanent "0 pending" row is noise a manager learns to skip. */}
          {!!pending && (pending.registrations > 0 || pending.results > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {pending.registrations > 0 && (
                <ActionCard
                  icon={UserPlus}
                  tone="amber"
                  count={pending.registrations}
                  label={t('pendingRegistrations')}
                  onClick={() => onGoTab('registrations')}
                />
              )}
              {pending.results > 0 && (
                <ActionCard
                  icon={Trophy}
                  tone="amber"
                  count={pending.results}
                  label={t('pendingResults')}
                  onClick={() => onGoTab('results')}
                />
              )}
            </div>
          )}

          {/* The goal bands and their paces — sat with the inbox rather than
              lower down because an unpriced band is a blocked planner, which is
              the same kind of thing as an unreviewed registration: work waiting
              on the manager, not a statistic. */}
          {(data?.bands?.length ?? 0) > 0 && (
            <BandPaces
              bands={data!.bands}
              canEdit={data!.scope === 'academy'}
              onChanged={onChanged}
            />
          )}

          {/* Who needs a coach's attention, and why. */}
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
              <div className="space-y-2">
                {atRisk.slice(0, ATTENTION_PREVIEW).map((m) => (
                  <button
                    key={m.athleteId}
                    onClick={() => onSelectMember(m)}
                    className="w-full flex items-center gap-3 rounded-card bg-card/50 border border-page/50 p-3 text-start hover:bg-page/80 active:scale-[0.99] transition-all min-h-[44px]"
                  >
                    <Avatar member={m} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-ink-700 truncate">{m.name}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {ATTENTION_ORDER.filter((r) => m.attention.includes(r)).slice(0, 2).map((r) => (
                          <span key={r} className={cn('text-3xs font-semibold px-1.5 py-0.5 rounded border', ATTENTION_STYLE[r])}>
                            {t(`reason_${r}`)}
                          </span>
                        ))}
                      </div>
                    </div>
                    <AlertTriangle className="h-4 w-4 text-band-3 shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Group rollup — a manager's second question after "how is the academy",
              because plans and coaches are assigned per group. */}
          {(data?.groups?.length ?? 0) > 1 && (
            <div>
              <SectionHeader title={t('groupsHeader')} />
              <div className="space-y-2">
                {data!.groups.map((g) => (
                  <Card key={g.groupId ?? '__none__'} variant="solid" className="flex items-center gap-3 py-3">
                    <span className="w-8 h-8 rounded-lg bg-purple-500/15 flex items-center justify-center shrink-0">
                      <Layers className="h-4 w-4 text-purple-700" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-ink-700 truncate">
                        {g.groupName || t('unassigned')}
                      </div>
                      <div className="text-xs text-ink-400">{t('membersCount', { count: g.members })}</div>
                    </div>
                    <div className="text-end shrink-0">
                      <div className="text-sm font-bold text-ink-700 tabular-nums">{g.weekKm.toFixed(1)}</div>
                      <div className="text-3xs text-ink-400 -mt-0.5">{t('kmUnit')}</div>
                    </div>
                    <div className={cn('w-12 text-end shrink-0 text-sm font-bold tabular-nums', rateColor(g.completionRate))}>
                      {fmtRate(g.completionRate)}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Volume board for the week. */}
          <div>
            <SectionHeader
              title={t('topThisWeek')}
              actionLabel={t('seeAll')}
              onAction={() => onGoTab('members')}
            />
            {top.length === 0 ? (
              <Card variant="muted">
                <p className="text-xs text-ink-400 text-center py-2">{t('noRunsThisWeek')}</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {top.map((m, i) => (
                  <button
                    key={m.athleteId}
                    onClick={() => onSelectMember(m)}
                    className="w-full flex items-center gap-3 rounded-card bg-card/50 border border-page/50 p-3 text-start hover:bg-page/80 active:scale-[0.99] transition-all min-h-[44px]"
                  >
                    <span className="w-4 text-center text-xs font-bold text-ink-400 shrink-0">{i + 1}</span>
                    <Avatar member={m} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-ink-700 truncate">{m.name}</div>
                      <div className="text-xs text-ink-400">
                        {t('runsCount', { count: m.weekRuns })}
                        {m.completionRate !== null && ` · ${fmtRate(m.completionRate)}`}
                      </div>
                    </div>
                    <div className="text-end shrink-0">
                      <div className="text-base font-bold text-ink-700 tabular-nums">{m.weekKm.toFixed(1)}</div>
                      <div className="text-3xs text-ink-400 -mt-0.5">{t('kmUnit')}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Two facts that don't belong in the headline four but do belong on the
              page: how many members can actually be tracked, and how many
              planned sessions the week contained at all. */}
          <div className="grid grid-cols-2 gap-2.5">
            <Tile icon={Watch} label={t('statConnected')} value={`${team.connected}/${team.members}`}
              valueClass={team.connected < team.members ? 'text-band-3' : undefined} />
            <Tile icon={ClipboardCheck} label={t('statPlannedSessions')} value={`${team.completed}/${team.planned}`}
              onClick={() => onGoTab('compliance')} />
          </div>
        </>
      )}
    </div>
  );
}

function Avatar({ member }: { member: AcademyMember }) {
  if (member.avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={member.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />;
  }
  return (
    <div className="w-9 h-9 rounded-full bg-brand-600/20 flex items-center justify-center text-xs font-bold text-brand-600 shrink-0">
      {initialsOf(member.name)}
    </div>
  );
}

function SectionHeader({
  title, count, actionLabel, onAction,
}: {
  title: string;
  count?: number;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-1 mb-2">
      <h2 className="text-sm font-bold text-ink-700">
        {title}
        {count !== undefined && count > 0 && <span className="ms-1.5 text-ink-400 font-semibold">{count}</span>}
      </h2>
      {actionLabel && onAction && (
        <button onClick={onAction} className="text-xs font-semibold text-brand-600 hover:text-brand-700 min-h-[32px]">
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function Tile({
  icon: Icon, label, value, valueClass, onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  valueClass?: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <div className="flex items-center gap-1.5 text-ink-400 mb-1">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-3xs font-semibold uppercase tracking-wider truncate">{label}</span>
      </div>
      <div className={cn('text-2xl font-bold tabular-nums', valueClass || 'text-ink-700')}>{value}</div>
    </>
  );
  if (onClick) {
    return (
      <button onClick={onClick} className="rounded-card border border-page/60 bg-card/60 p-3.5 text-start hover:bg-page/90 active:scale-[0.98] transition-all">
        {inner}
      </button>
    );
  }
  return <div className="rounded-card border border-page/60 bg-card/60 p-3.5">{inner}</div>;
}

function ActionCard({
  icon: Icon, count, label, onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: 'amber';
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 rounded-2xl border border-band-3/30 bg-band-3/10 p-3.5 text-start hover:bg-band-3/15 active:scale-[0.99] transition-all min-h-[44px]"
    >
      <span className="w-9 h-9 rounded-xl bg-band-3/20 flex items-center justify-center shrink-0">
        <Icon className="h-4 w-4 text-band-3" />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold text-ink-700">{count}</div>
        <div className="text-xs text-band-3/80 truncate">{label}</div>
      </div>
      <ChevronLeft className="h-4 w-4 text-band-3/70 shrink-0" />
    </button>
  );
}
