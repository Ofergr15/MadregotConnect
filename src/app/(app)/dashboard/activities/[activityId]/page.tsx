'use client';

/**
 * /dashboard/activities/[activityId] — one run, in full.
 *
 * Where tapping a workout in the feed lands. Everything below the header is
 * `ActivityDetailBody`, the same component the activities list expands inline,
 * so a run looks the same wherever it's opened from.
 *
 * Any club member may open any member's run (see the note on
 * /api/activities/details) — the route, splits and charts are club-visible.
 */

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, MessageCircle, Route, Share2 } from 'lucide-react';
import { BackNav, Button, EmptyState, LoadingBlock } from '@/components/ui';
import { ActivitySyncEditor } from '@/components/ActivitySyncEditor';
import { ActivityDetailBody } from '@/components/activity/ActivityDetailBody';
import { getTimeLabel, resolveRunTypeBadge } from '@/components/activity/format';
import { useActivityDetails } from '@/components/activity/useActivityDetails';
import { activityLocalDay, cn, formatActivityDate, formatActivityTime } from '@/lib/utils';

const HEBREW_DAYS = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'שבת'];

export default function ActivityDetailPage() {
  const { activityId } = useParams<{ activityId: string }>();
  const router = useRouter();
  const t = useTranslations('activities');
  const tc = useTranslations('common');
  const locale = useLocale();

  const [myAthleteId, setMyAthleteId] = useState<string | null>(null);
  const [isStaff, setIsStaff] = useState(false);
  const [showShare, setShowShare] = useState(false);

  useEffect(() => {
    setMyAthleteId(localStorage.getItem('athlete_id'));
    setIsStaff(!!localStorage.getItem('coach_email'));
  }, []);

  // No athleteId to pass — arriving here from a feed card, the activity uuid is
  // all we have. The route looks it up by id and returns the summary row with it.
  const { details, loading, error, planned, plannedContinuous, verdict } = useActivityDetails({
    activityId,
    auto: true,
  });

  const act = details?.activity ?? null;

  if (loading && !act) return <LoadingBlock className="min-h-[60vh]" />;

  if (error || !act) {
    return (
      <div className="max-w-lg mx-auto px-4 py-10">
        <EmptyState
          icon={AlertCircle}
          title={error === 'forbidden' ? t('detailNoAccess') : t('detailNotFound')}
          description={t('detailNotFoundHint')}
          action={
            <Button variant="secondary" onClick={() => router.back()}>
              {tc('back')}
            </Button>
          }
        />
      </div>
    );
  }

  const isMyActivity = !!myAthleteId && act.athlete_id === myAthleteId;
  const runChatLabel = isStaff && !isMyActivity ? 'שוחח עם הרץ' : 'שוחח עם המאמן';
  const runType = resolveRunTypeBadge(act.activity_type, act.distance / 1000, act.average_pace);
  const dayLabel = HEBREW_DAYS[activityLocalDay(act.start_time)];

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 pb-10 space-y-4">
      <BackNav label={tc('back')} onBack={() => router.back()} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-full bg-brand-600/15 flex items-center justify-center shrink-0">
            <Route className="h-5 w-5 text-brand-600" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-bold text-ink-700 truncate">{dayLabel}</h1>
              <span className={cn('text-3xs font-bold px-2 py-0.5 rounded', runType.bg, runType.color)}>
                {runType.label}
              </span>
            </div>
            <p className="text-xs text-ink-400">
              {act.athlete_name || 'Unknown'} · {formatActivityDate(act.start_time, locale)} · {formatActivityTime(act.start_time)}
            </p>
            <p className="text-xs text-ink-400">
              {getTimeLabel(act.start_time)}{act.location_name ? ` · ${act.location_name}` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isMyActivity && (
            <button
              onClick={() => setShowShare(true)}
              className="flex items-center gap-1.5 rounded-lg border border-ink-300/50 bg-page/30 px-2.5 py-1.5 text-xs font-semibold text-ink-500 transition-colors hover:bg-page/60 hover:text-ink-900"
              aria-label="שיתוף בפיד"
              title="שיתוף בפיד"
            >
              <Share2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">שיתוף</span>
            </button>
          )}
          <button
            onClick={() => router.push(`/dashboard/run-chat/${act.id}`)}
            className="flex items-center gap-1.5 rounded-lg border border-brand-600/30 bg-brand-600/10 px-2.5 py-1.5 text-xs font-semibold text-brand-600 transition-colors hover:bg-brand-600/20 hover:text-brand-700"
            aria-label={runChatLabel}
            title={runChatLabel}
          >
            <MessageCircle className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{runChatLabel}</span>
          </button>
        </div>
      </div>

      <ActivityDetailBody
        activity={act}
        details={details}
        loading={loading}
        planned={planned}
        plannedContinuous={plannedContinuous}
        verdict={verdict}
        loadingVerdict={loading}
      />

      {showShare && (
        <ActivitySyncEditor activity={act} onClose={() => setShowShare(false)} />
      )}
    </div>
  );
}
