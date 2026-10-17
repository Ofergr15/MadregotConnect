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
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, ArrowRight, MessageCircle, Share2 } from 'lucide-react';
import { BackNav, Button, EmptyState, LoadingBlock } from '@/components/ui';
import { ActivitySyncEditor } from '@/components/ActivitySyncEditor';
import { ActivityDetailBody } from '@/components/activity/ActivityDetailBody';
import { ActivityName } from '@/components/activity/ActivityName';
import { resolveRunTypeBadge } from '@/components/activity/format';
import { useActivityDetails } from '@/components/activity/useActivityDetails';
import { AthleteLink } from '@/components/AthleteLink';
import { FeedAvatar } from '@/components/FeedAvatar';
import { displayRunName } from '@/lib/activities/run-name';
import { PrBadge, usePrRuns } from '@/components/PrBadge';
import { RunRecords } from '@/components/records/RunRecords';
import { recordHref } from '@/components/profile/pr-format';
import { cn, formatActivityDate, formatActivityTime } from '@/lib/utils';

export default function ActivityDetailPage() {
  const { activityId } = useParams<{ activityId: string }>();
  const router = useRouter();
  // `?view=map` — screen 5's "מפה וגרף" tab: the map and the pace/HR graphs only. Its own
  // verdict, run-type tag and coloured splits answer "was it to plan" differently from the
  // screen the trainee just came from, so they are not drawn there.
  const mapOnly = useSearchParams()?.get('view') === 'map';
  const t = useTranslations('activities');
  const tc = useTranslations('common');
  const tr = useTranslations('runPage');
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
  const prRuns = usePrRuns();

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
  // Run-chat is the runner's thread with their coach: the runner and staff only —
  // the same rule the feed card applies. It used to show to every member here.
  const canRunChat = isMyActivity || isStaff;
  const runChatLabel = isStaff && !isMyActivity ? 'שוחח עם הרץ' : 'שוחח עם המאמן';
  const runType = resolveRunTypeBadge(act.activity_type, act.distance / 1000, act.average_pace);
  const source = act.source === 'garmin' ? 'Garmin' : act.source === 'strava' ? 'Strava' : null;
  const floatBtn = 'grid h-11 w-11 place-items-center rounded-full bg-white/95 text-ink-700 shadow-md backdrop-blur';

  const actions = (
    <>
      {isMyActivity && (
        <button onClick={() => setShowShare(true)} className={floatBtn} aria-label="שיתוף בפיד" title="שיתוף בפיד">
          <Share2 className="h-[18px] w-[18px]" />
        </button>
      )}
      {canRunChat && (
        <button onClick={() => router.push(`/dashboard/run-chat/${act.id}`)} className={floatBtn} aria-label={runChatLabel} title={runChatLabel}>
          <MessageCircle className="h-[18px] w-[18px]" />
        </button>
      )}
    </>
  );

  const header = (
    <section className="rounded-card border border-page bg-card p-4">
      <div className="flex items-center gap-3">
        <FeedAvatar name={act.athlete_name || ''} url={act.athlete_avatar_url ?? null} className="h-10 w-10" />
        <div className="min-w-0">
          <AthleteLink athleteId={isMyActivity ? null : act.athlete_id} name={act.athlete_name} className="block truncate text-[15px] font-bold text-ink-900">
            {act.athlete_name || ''}
          </AthleteLink>
          <p className="truncate text-xs text-ink-400">
            {formatActivityDate(act.start_time, locale)} · {formatActivityTime(act.start_time)}
            {act.location_name ? ` · ${act.location_name}` : ''}
            {source ? ` · ${source}` : ''}
          </p>
        </div>
      </div>
      <div className="mt-3">
        {/* The run's own name — Hebrew for the watch's automatic ones — and its
            owner's pencil (#92). */}
        <ActivityName
          activityId={act.id}
          name={act.activity_name}
          editable={isMyActivity}
          format={(n) => displayRunName(n, act.start_time, locale)}
          title
        />
      </div>
      {!mapOnly && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className={cn('rounded-full px-2.5 py-0.5 text-2xs font-bold', runType.bg, runType.color)}>
            {tr(`runType_${runType.type}` as 'runType_easy')}
          </span>
          <PrBadge
            buckets={prRuns.get(act.id)}
            href={prRuns.get(act.id)?.length && act.athlete_id
              ? recordHref(act.athlete_id, prRuns.get(act.id)![0]) ?? undefined
              : undefined}
          />
        </div>
      )}
    </section>
  );

  return (
    <div className="mx-auto max-w-4xl px-4 pb-10 sm:px-6">
      <ActivityDetailBody
        activity={act}
        details={details}
        loading={loading}
        planned={planned}
        plannedContinuous={plannedContinuous}
        verdict={verdict}
        loadingVerdict={loading}
        mapOnly={mapOnly}
        renderMap={(map) => (
          <>
            {map ? (
              // Strava's hero: the route is the first thing the run page says, and
              // the buttons float over it.
              <div className="relative overflow-hidden rounded-card">
                {map}
                <button onClick={() => router.back()} className={cn(floatBtn, 'absolute right-3 top-3 z-[1000]')} aria-label={tc('back')}>
                  <ArrowRight className="h-5 w-5 rtl:rotate-0 ltr:rotate-180" />
                </button>
                <div className="absolute left-3 top-3 z-[1000] flex gap-2">{actions}</div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <BackNav label={tc('back')} onBack={() => router.back()} />
                <div className="flex gap-2">{actions}</div>
              </div>
            )}
            {header}
            {/* The records this run set, and taking it out of them (migration 146). */}
            {!mapOnly && act.athlete_id && (
              <RunRecords athleteId={act.athlete_id} activityId={act.id} owner={isMyActivity} />
            )}
          </>
        )}
      />

      {showShare && (
        <ActivitySyncEditor activity={act} onClose={() => setShowShare(false)} />
      )}
    </div>
  );
}
