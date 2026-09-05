'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity, Heart, Route, Mountain,
  ChevronDown, ChevronUp, MessageCircle, Share2, Maximize2,
} from 'lucide-react';
import { cn, formatActivityTime, formatActivityDate, activityLocalDay } from '@/lib/utils';
import { ActivitySyncEditor } from '@/components/ActivitySyncEditor';
import { ActivityDetailBody } from '@/components/activity/ActivityDetailBody';
import {
  formatDuration, formatPace, getHRZone, getTimeLabel, resolveRunTypeBadge,
} from '@/components/activity/format';
import { useAthleteMaxHR } from '@/components/activity/useAthleteMaxHR';
import { useLocale, useTranslations } from 'next-intl';
import type { ActivityEntry } from '@/components/activity/types';
import { useActivityDetails } from '@/components/activity/useActivityDetails';

// The map, charts, splits table, formatters and types all used to live in this
// file. They're in `@/components/activity/*` now, shared with the standalone
// /dashboard/activities/[activityId] page a feed card opens — two copies of a
// run's detail view had already started to drift.

// ─── Activity Card ─────────────────────────────────────────────────────────────

function ActivityCard({
  activity,
  myAthleteId,
  isStaff,
}: {
  activity: ActivityEntry;
  myAthleteId: string | null;
  isStaff: boolean;
}) {
  const t = useTranslations('activities');
  const locale = useLocale();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const isMyActivity = !!myAthleteId && activity.athlete_id === myAthleteId;
  const runChatLabel = isStaff && !isMyActivity ? 'שוחח עם הרץ' : 'שוחח עם המאמן';
  // Manual re-open of the same customize-before-posting sheet the background
  // sync shows automatically once — this lets an athlete share (or edit the
  // sharing of) any past run, not just the one that was just synced.
  const [showShare, setShowShare] = useState(false);

  const { details, loading: loadingDetails, planned, load } = useActivityDetails({
    activityId: activity.id,
    athleteId: activity.athlete_id,
    startTime: activity.start_time,
    fallbackSplits: activity.splits,
  });

  const distKm = (activity.distance / 1000).toFixed(1);
  const distKmNum = activity.distance / 1000;
  const paceStr = activity.average_pace ? formatPace(activity.average_pace) : null;
  const durationStr = formatDuration(activity.duration);
  const dateStr = formatActivityDate(activity.start_time, locale);
  const timeStr = formatActivityTime(activity.start_time);
  const hebrewDays = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'שבת'];
  const dayLabel = hebrewDays[activityLocalDay(activity.start_time)];
  const timeLabel = getTimeLabel(activity.start_time);
  // 220 - age where the birth date is readable, 190 otherwise, never below what
  // the run itself recorded — see useAthleteMaxHR.
  const maxHRAt = useAthleteMaxHR(activity.athlete_id);
  const maxHR = Math.max(maxHRAt(activity.start_time), activity.max_hr ?? 0);
  const hrZone = activity.average_hr ? getHRZone(activity.average_hr, maxHR) : null;
  // The provider's own sport first (trail / treadmill / track); the distance-and-
  // pace guess only for a plain road run.
  const runType = resolveRunTypeBadge(activity.activity_type, distKmNum, activity.average_pace);

  const handleExpand = () => {
    if (!expanded) load();
    setExpanded(!expanded);
  };

  return (
    <>
    <div className="bg-card/50 rounded-card border border-page/30 overflow-hidden">
      {/* Collapsed card. A div rather than a <button> because it contains its own
          buttons and links (open the full run, the teammate's name), and a button
          inside a button is invalid markup that double-fires. So it carries the
          role and the keys by hand — it was a plain onClick, i.e. mouse-only, and
          expanding a run was the whole point of the card. `aria-expanded` is what
          tells a screen reader this is a disclosure and which way it's pointing. */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={handleExpand}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleExpand();
          }
        }}
        className="p-4 sm:p-5 cursor-pointer hover:bg-page/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-brand-600/15 flex items-center justify-center">
              <Route className="h-4 w-4 text-brand-600" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-ink-700">{activity.athlete_name || 'Unknown'}</span>
                <span className="text-xs text-ink-400">{dateStr} · {timeStr}</span>
              </div>
              <p className="text-xs text-ink-400">{timeLabel}{activity.location_name ? ` · ${activity.location_name}` : ''}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isMyActivity && (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  setShowShare(true);
                }}
                className="flex items-center gap-1.5 rounded-lg border border-ink-300/50 bg-page/30 px-2.5 py-1.5 text-xs font-semibold text-ink-500 transition-colors hover:bg-page/60 hover:text-ink-900"
                aria-label="שיתוף בפיד"
                title="שיתוף בפיד"
              >
                <Share2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">שיתוף</span>
              </button>
            )}
            <button
              onClick={(event) => {
                event.stopPropagation();
                router.push(`/dashboard/activities/${activity.id}`);
              }}
              className="flex items-center gap-1.5 rounded-lg border border-ink-300/50 bg-page/30 px-2.5 py-1.5 text-xs font-semibold text-ink-500 transition-colors hover:bg-page/60 hover:text-ink-900"
              aria-label="פתח באמצעות דף מלא"
              title="פתח באמצעות דף מלא"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={(event) => {
                event.stopPropagation();
                router.push(`/dashboard/run-chat/${activity.id}`);
              }}
              className="flex items-center gap-1.5 rounded-lg border border-brand-600/30 bg-brand-600/10 px-2.5 py-1.5 text-xs font-semibold text-brand-600 transition-colors hover:bg-brand-600/20 hover:text-brand-700"
              aria-label={runChatLabel}
              title={runChatLabel}
            >
              <MessageCircle className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{runChatLabel}</span>
            </button>
            <span className={cn('text-3xs font-bold px-2 py-0.5 rounded', runType.bg, runType.color)}>
              {t(`runType_${runType.type}` as 'runType_easy')}
            </span>
            {expanded ? <ChevronUp className="h-4 w-4 text-ink-400" /> : <ChevronDown className="h-4 w-4 text-ink-400" />}
          </div>
        </div>

        <p className="text-base font-semibold text-ink-700 mb-3">{dayLabel}</p>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div>
            <p className="text-3xs text-ink-400 font-medium">{t('distance')}</p>
            <p className="text-lg font-black text-ink-700 tabular-nums">{distKm}<span className="text-xs text-ink-400 ms-0.5">km</span></p>
          </div>
          <div>
            <p className="text-3xs text-ink-400 font-medium">{t('pace')}</p>
            <p className="text-lg font-black text-ink-700 tabular-nums">{paceStr || '—'}<span className="text-xs text-ink-400 ms-0.5">/km</span></p>
          </div>
          <div>
            <p className="text-3xs text-ink-400 font-medium">{t('duration')}</p>
            <p className="text-lg font-black text-ink-700 tabular-nums">{durationStr}</p>
          </div>
          {activity.average_hr && (
            <div className="hidden lg:block">
              <p className="text-3xs text-ink-400 font-medium">{t('avgHrShort')}</p>
              <p className={cn("text-lg font-black tabular-nums flex items-center gap-1", hrZone?.color)}>
                <Heart className="h-3.5 w-3.5" />{activity.average_hr}
              </p>
            </div>
          )}
          {activity.elevation_gain && activity.elevation_gain > 0 ? (
            <div className="hidden lg:block">
              <p className="text-3xs text-ink-400 font-medium">{t('elevation')}</p>
              <p className="text-lg font-black text-ink-700 tabular-nums flex items-center gap-1">
                <Mountain className="h-3.5 w-3.5 text-accent-600" />{Math.round(activity.elevation_gain)}<span className="text-xs text-ink-400">m</span>
              </p>
            </div>
          ) : null}
        </div>

      </div>

      {/* Expanded detail */}
      {expanded && (
        <ActivityDetailBody
          activity={activity}
          details={details}
          loading={loadingDetails}
          planned={planned}
          className="border-t border-page/50 px-4 sm:px-5 py-5"
        />
      )}
    </div>
    {showShare && (
      <ActivitySyncEditor activity={activity} onClose={() => setShowShare(false)} />
    )}
    </>
  );
}

// ─── Activity Feed (exported) ──────────────────────────────────────────────────

interface ActivityFeedProps {
  activities: ActivityEntry[];
  syncing: boolean;
  lastSyncTime: string | null;
  onSync: () => void;
  myAthleteId?: string | null;
  isStaff?: boolean;
}

export function ActivityFeed({
  activities,
  syncing,
  myAthleteId = null,
  isStaff = false,
}: ActivityFeedProps) {
  const t = useTranslations('activities');

  if (activities.length === 0 && !syncing) {
    return (
      <div className="bg-card/30 rounded-card border border-page/20 p-8 text-center">
        <Activity className="h-8 w-8 text-ink-400 mx-auto mb-3" />
        <p className="text-sm text-ink-400">{t('noActivitiesWeek')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {activities.map(act => (
        <ActivityCard
          key={act.id}
          activity={act}
          myAthleteId={myAthleteId}
          isStaff={isStaff}
        />
      ))}
    </div>
  );
}
