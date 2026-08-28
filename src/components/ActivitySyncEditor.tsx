'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  X, Loader2, ImagePlus, ChevronRight, Globe, Lock, Users,
  Flame, Heart, Gauge, Zap, Share2, Pencil, Tag as TagIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  fetchFeedItemByActivity, updateFeedItem, uploadMedia,
  type FeedHiddenField,
} from '@/lib/feed-client';
import { fetchPlanMatch } from '@/lib/activities-client';
import { WORKOUT_TYPE_LABELS } from '@/lib/plans/workout-parsing';
import { Sheet, Spinner } from '@/components/ui';
import { RouteMinimap } from '@/components/RouteMinimap';
import { FeedShareSheet } from '@/components/FeedShareSheet';
import type { FeedItem, FeedMedia } from '@/lib/feed/project';

interface PlanMatch { pct: number; actualKm: number; targetKm: number; type: string }

// Green near the target, amber a bit off, red way off in either direction —
// same 3-tier severity language as the feedback form's difficulty colors.
function planMatchColor(pct: number): string {
  const diff = Math.abs(pct - 100);
  if (diff <= 15) return '#10b981';
  if (diff <= 35) return '#f59e0b';
  return '#ef4444';
}

const MAX_IMAGES = 4;
const MAX_NAME_LENGTH = 80;
const MAX_TAG_LENGTH = 24;

/**
 * Minimal shape this component needs from an athlete_activities row. The
 * dashboard's own `RecentActivity` (already fetched for the recap cards)
 * satisfies this directly — no extra round trip for the stats themselves.
 */
export interface SyncedActivity {
  id: string;
  activity_name: string | null;
  distance: number;
  duration: number;
  average_pace: number | null;
  average_hr?: number | null;
  calories?: number | null;
  elevation_gain?: number | null;
}

function formatPace(secPerKm: number): string {
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${String(sec).padStart(2, '0')}`;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const HIDDEN_FIELD_DEFS: Array<{ key: FeedHiddenField; labelKey: string; icon: typeof Flame }> = [
  { key: 'calories', labelKey: 'hideCalories', icon: Flame },
  { key: 'heart_rate', labelKey: 'hideHeartRate', icon: Heart },
  { key: 'pace', labelKey: 'hidePace', icon: Gauge },
  { key: 'power', labelKey: 'hidePower', icon: Zap },
];

function isFeedHiddenField(v: unknown): v is FeedHiddenField {
  return v === 'calories' || v === 'heart_rate' || v === 'pace' || v === 'power';
}

/**
 * Strava-style bottom sheet shown right after a new Garmin/Strava activity
 * syncs, letting the athlete customize how the auto-created feed post looks
 * before it's out in the club feed — name, description, tag, photo, audience,
 * hidden stats.
 *
 * The name field overrides `athlete_activities.activity_name` directly (a
 * second, separate PATCH scoped to the athlete's own row — see
 * /api/feed/items/[id]); tag/description/audience/photos/hidden-stats are all
 * feed_items concerns folded into the same PATCH call.
 *
 * NOTE: this only works once migration 047_social_feed.sql has been applied —
 * until then `fetchFeedItemByActivity` 404s/500s (no feed_items table yet)
 * and the sheet degrades to a read-only stats recap (see loadError below).
 */
export function ActivitySyncEditor({
  activity,
  extraCount = 0,
  onClose,
}: {
  activity: SyncedActivity;
  /** How many OTHER newly-synced activities are being skipped past this one. */
  extraCount?: number;
  onClose: () => void;
}) {
  const t = useTranslations('feed.syncEditor');
  const tFeed = useTranslations('feed');
  const fileRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedItem, setFeedItem] = useState<FeedItem | null>(null);

  const [activityName, setActivityName] = useState(activity.activity_name || '');
  // Snapshot of the name as last loaded from the server — lets handleDone
  // below skip re-sending activityName when it was never touched, so a tab
  // that only edited the tag/caption/photos can't blow away a rename that
  // happened concurrently in another tab (no version/lost-update guard exists
  // on this PATCH otherwise; this is the cheap, common-case mitigation).
  const loadedNameRef = useRef(activity.activity_name || '');
  const [caption, setCaption] = useState('');
  const [tag, setTag] = useState('');
  const [media, setMedia] = useState<FeedMedia[]>([]);
  const [visibility, setVisibility] = useState<'club' | 'private'>('club');
  const [hidden, setHidden] = useState<Set<FeedHiddenField>>(new Set());

  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showShare, setShowShare] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { item } = await fetchFeedItemByActivity(activity.id);
      setFeedItem(item);
      setCaption(item.body || '');
      setMedia(item.media);
      const rawHidden = (item.payload?.hiddenFields as unknown[]) || [];
      setHidden(new Set(rawHidden.filter(isFeedHiddenField)));
      if (typeof item.payload?.tag === 'string') setTag(item.payload.tag);
      if (item.activity?.activityName) {
        setActivityName(item.activity.activityName);
        loadedNameRef.current = item.activity.activityName;
      }
    } catch (err: unknown) {
      setLoadError((err as Error).message || t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [activity.id, t]);

  useEffect(() => {
    load();
  }, [load]);

  // Independent of `load()` above — this only reads the activity row + the
  // club's plan, not feed_items, so it still renders when the feed portion of
  // this sheet is signed out (see loadError === 'NOT_SIGNED_IN').
  const [planMatch, setPlanMatch] = useState<PlanMatch | null>(null);
  useEffect(() => {
    fetchPlanMatch(activity.id)
      .then(res => res.json())
      .then(data => { if (data.matched) setPlanMatch(data); })
      .catch(() => {});
  }, [activity.id]);

  const distKm = (activity.distance / 1000).toFixed(1);
  const paceStr = activity.average_pace ? formatPace(activity.average_pace) : null;
  const durationStr = formatDuration(activity.duration);
  const routePoints = feedItem?.activity?.routePreview ?? null;
  const hasRoute = !!routePoints && routePoints.length > 2;

  const toggleHidden = (field: FeedHiddenField) => {
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  };

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const remaining = MAX_IMAGES - media.length;
    if (remaining <= 0) return;
    const toUpload = Array.from(files).slice(0, remaining);
    setUploading(true);
    // Multi-selecting more photos than the remaining slots used to silently
    // drop the extras with zero feedback — the athlete believed all of them
    // were added. Surface it the same way any other save issue shows up here.
    setSaveError(files.length > remaining ? t('tooManyPhotos', { count: MAX_IMAGES }) : null);
    try {
      const uploaded = await Promise.all(toUpload.map(f => uploadMedia(f)));
      setMedia(prev => [...prev, ...uploaded]);
    } catch (err: unknown) {
      setSaveError((err as Error).message || t('saveError'));
    } finally {
      setUploading(false);
    }
  }, [media.length, t]);

  const removeMedia = (path: string) => {
    setMedia(prev => prev.filter(m => m.path !== path));
  };

  const handleDone = async () => {
    // No feed_item to attach edits to (load failed, e.g. migration 047 isn't
    // applied yet) — just dismiss; there is nothing safe to save.
    if (!feedItem) { onClose(); return; }

    // An accidentally-cleared name shouldn't block Done — fall back to the
    // original rather than surfacing a "name required" error for that.
    // .trim() the fallback too — a whitespace-only activity_name from the
    // provider (Garmin/Strava send it verbatim, unsanitized) is truthy in JS,
    // so without trimming it here the PATCH below would still send whitespace
    // and get rejected by the server's own trim-based emptiness check,
    // blocking the tag/caption/media edits bundled into the same call.
    const finalName = activityName.trim() || activity.activity_name?.trim() || 'Run';
    // Only resend the name if it actually changed from what was loaded — see
    // loadedNameRef's comment. Prevents this tab silently reverting a rename
    // made concurrently elsewhere just because Done was clicked here too.
    const nameChanged = finalName !== loadedNameRef.current;

    setSaving(true);
    setSaveError(null);
    try {
      await updateFeedItem(feedItem.id, {
        body: caption,
        visibility,
        media,
        hiddenFields: Array.from(hidden),
        tag: tag.trim() || null,
        ...(nameChanged ? { activityName: finalName } : {}),
      });
      onClose();
    } catch (err: unknown) {
      setSaveError((err as Error).message || t('saveError'));
      setSaving(false);
    }
  };

  const editable = !loading && !loadError && !!feedItem;

  return (
    <>
    <Sheet
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      leadingAction={
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
          aria-label={tFeed('close')}
        >
          <X className="h-5 w-5" />
        </button>
      }
      className="max-h-[92vh]"
      bodyClassName="flex-1 min-h-0"
      footer={
        <div className="flex-none px-4 pt-2 pb-3 border-t border-slate-700/60 space-y-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*,image/heic,image/heif"
            multiple
            className="hidden"
            onChange={e => handleFiles(e.target.files)}
          />
          <button
            onClick={handleDone}
            disabled={saving || uploading}
            className={cn(
              'w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-base font-bold transition-all',
              !saving && !uploading
                ? 'bg-primary-600 text-white active:scale-[0.98]'
                : 'bg-slate-700 text-slate-500',
            )}
          >
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : t('done')}
          </button>
          <div className="flex items-center justify-center gap-5">
            <Link
              href="/dashboard/activities"
              onClick={onClose}
              className="text-sm font-semibold text-slate-400 hover:text-primary-400 inline-flex items-center gap-0.5 transition-colors"
            >
              {t('advancedEdit')} <ChevronRight className="h-3.5 w-3.5" />
            </Link>
            <button
              onClick={() => setShowShare(true)}
              disabled={!feedItem}
              className={cn(
                'inline-flex items-center gap-1.5 text-sm font-semibold transition-colors',
                feedItem ? 'text-slate-400 hover:text-primary-400' : 'text-slate-600',
              )}
            >
              <Share2 className="h-3.5 w-3.5" /> {tFeed('shareToStory')}
            </button>
          </div>
        </div>
      }
    >
      <div className="px-1 pb-2 space-y-4">
        {/* Name / description / tag — grouped into one card, matching the
            native Strava/Garmin "share this run" composer. */}
        <div>
          <div className="rounded-xl border border-slate-700/60 divide-y divide-slate-700/50 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2.5">
              <input
                value={activityName}
                onChange={e => setActivityName(e.target.value)}
                maxLength={MAX_NAME_LENGTH}
                disabled={!editable}
                className="flex-1 bg-transparent text-base font-bold text-white placeholder:text-slate-500 focus:outline-none disabled:opacity-60"
              />
              <Pencil className="h-4 w-4 text-slate-500 shrink-0" />
            </div>
            <textarea
              value={caption}
              onChange={e => setCaption(e.target.value)}
              placeholder={t('captionPlaceholder')}
              disabled={!editable}
              rows={2}
              className="w-full px-3 py-2.5 bg-transparent text-sm text-slate-300 placeholder:text-slate-500 leading-relaxed resize-none focus:outline-none disabled:opacity-60"
            />
            <div className="flex items-center gap-2 px-3 py-2.5">
              <TagIcon className="h-4 w-4 text-slate-500 shrink-0" />
              <input
                value={tag}
                onChange={e => setTag(e.target.value)}
                placeholder={t('tagPlaceholder')}
                maxLength={MAX_TAG_LENGTH}
                disabled={!editable}
                className="flex-1 bg-transparent text-sm text-slate-300 placeholder:text-slate-500 focus:outline-none disabled:opacity-60"
              />
            </div>
          </div>
          {extraCount > 0 && (
            <span className="inline-block mt-2 text-2xs font-bold px-2 py-0.5 rounded-full bg-primary-600/10 text-primary-400 border border-primary-600/20">
              {t('moreActivities', { count: extraCount })}
            </span>
          )}
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-slate-900/50 rounded-xl p-2.5 text-center">
            <p className="text-[10px] text-slate-500 font-medium mb-0.5">{tFeed('statDistance')}</p>
            <p className="text-base font-black text-white tabular-nums">
              {distKm}<span className="text-[10px] text-slate-400 ms-0.5">{tFeed('km')}</span>
            </p>
          </div>
          <div className="bg-slate-900/50 rounded-xl p-2.5 text-center">
            <p className="text-[10px] text-slate-500 font-medium mb-0.5">{tFeed('statPace')}</p>
            <p className="text-base font-black text-white tabular-nums">
              {paceStr || '—'}<span className="text-[10px] text-slate-400 ms-0.5">{tFeed('perKm')}</span>
            </p>
          </div>
          <div className="bg-slate-900/50 rounded-xl p-2.5 text-center">
            <p className="text-[10px] text-slate-500 font-medium mb-0.5">{tFeed('statTime')}</p>
            <p className="text-base font-black text-white tabular-nums">{durationStr}</p>
          </div>
        </div>

        {planMatch && (
          <div className="bg-slate-900/50 rounded-xl p-3">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-2xs font-bold text-slate-500 uppercase tracking-wider">{t('planMatchLabel')}</span>
              <span className="text-xl font-black tabular-nums" style={{ color: planMatchColor(planMatch.pct) }}>
                {planMatch.pct}%
              </span>
            </div>
            <div className="h-2 rounded-full bg-slate-700/60 overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(planMatch.pct, 100)}%`,
                  background: planMatchColor(planMatch.pct),
                }}
              />
            </div>
            <p className="mt-1.5 text-2xs text-slate-400">
              {t('planMatchSubtitle', { actual: planMatch.actualKm, target: planMatch.targetKm })}
              {WORKOUT_TYPE_LABELS[planMatch.type] && ` · ${WORKOUT_TYPE_LABELS[planMatch.type]}`}
            </p>
          </div>
        )}

        {/* Route thumbnail + "add photo" tile, side by side (native
            Strava/Garmin composer layout) — the tile takes the full row alone
            when there's no route to show. */}
        <div className={cn('grid gap-2', hasRoute ? 'grid-cols-2' : 'grid-cols-1')}>
          {hasRoute && <RouteMinimap points={routePoints!} className="!aspect-square h-full w-full" />}
          <button
            onClick={() => fileRef.current?.click()}
            disabled={!editable || media.length >= MAX_IMAGES || uploading}
            className={cn(
              'flex flex-col items-center justify-center gap-1.5 rounded-xl border min-h-[90px] transition-all',
              editable && media.length < MAX_IMAGES && !uploading
                ? 'border-slate-700 bg-slate-900/50 text-primary-400 hover:bg-slate-900'
                : 'border-slate-800 text-slate-600',
            )}
          >
            <ImagePlus className="h-5 w-5" />
            <span className="text-xs font-semibold">{t('addPhoto')}</span>
            {media.length > 0 && <span className="text-2xs text-slate-500">{media.length}/{MAX_IMAGES}</span>}
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-6">
            <Spinner size={28} />
          </div>
        )}

        {/* NOT_SIGNED_IN means the Supabase session expired (this endpoint needs
            a real JWT, same as the feed itself) — retrying would just fail the
            same way, so this case gets a real message + a way out instead of
            the raw error code. */}
        {loadError === 'NOT_SIGNED_IN' && !loading && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="text-sm text-amber-300">{tFeed('sessionExpiredBody')}</p>
            <Link href="/" className="mt-2 inline-block text-xs font-semibold text-amber-200 underline">
              {tFeed('signInAgain')}
            </Link>
          </div>
        )}

        {loadError && loadError !== 'NOT_SIGNED_IN' && !loading && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="text-sm text-amber-300">{loadError}</p>
            <button onClick={load} className="mt-2 text-xs font-semibold text-amber-200 underline">
              {t('retry')}
            </button>
          </div>
        )}

        {editable && (
          <>
            {/* Media thumbnails */}
            {media.length > 0 && (
              <div
                className={cn(
                  'gap-1.5',
                  media.length === 1 && 'block',
                  media.length >= 2 && 'grid',
                  media.length === 2 && 'grid-cols-2',
                  media.length >= 3 && 'grid-cols-2',
                )}
              >
                {media.map((m, i) => (
                  <div
                    key={m.path}
                    className={cn(
                      'relative overflow-hidden rounded-xl bg-slate-900',
                      media.length === 3 && i === 0 && 'col-span-2',
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={m.url}
                      alt=""
                      className="w-full object-cover"
                      style={{
                        aspectRatio: m.w && m.h ? `${m.w}/${m.h}` : '4/3',
                        maxHeight: media.length === 1 ? '280px' : '160px',
                      }}
                    />
                    <button
                      onClick={() => removeMedia(m.path)}
                      className="absolute top-2 end-2 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center text-white hover:bg-black/80"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {uploading && (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                {tFeed('uploadingImage')}
              </div>
            )}

            {/* Audience selector — "Followers" stays visibly disabled. The
                follow graph does exist now (lib/follows/club-sync.ts), but it's
                club-wide by design: everyone mutually follows everyone, so a
                Followers audience would be indistinguishable from Everyone. */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">{t('audienceTitle')}</p>
              <div className="flex gap-0.5 rounded-xl bg-slate-800 p-1 border border-slate-700">
                <button
                  onClick={() => setVisibility('club')}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition-colors min-h-[40px]',
                    visibility === 'club' ? 'bg-primary-600 text-white shadow-sm' : 'text-slate-400 hover:text-white',
                  )}
                >
                  <Globe className="h-3.5 w-3.5" /> {t('audienceEveryone')}
                </button>
                <button
                  disabled
                  aria-disabled
                  title={t('audienceComingSoon')}
                  className="flex-1 flex flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-600 cursor-not-allowed min-h-[40px]"
                >
                  <span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> {t('audienceFollowers')}</span>
                  <span className="text-[9px] text-slate-700">{t('audienceComingSoon')}</span>
                </button>
                <button
                  onClick={() => setVisibility('private')}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition-colors min-h-[40px]',
                    visibility === 'private' ? 'bg-primary-600 text-white shadow-sm' : 'text-slate-400 hover:text-white',
                  )}
                >
                  <Lock className="h-3.5 w-3.5" /> {t('audienceOnlyYou')}
                </button>
              </div>
            </div>

            {/* Hidden Details toggles */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">{t('hiddenDetailsTitle')}</p>
              <div className="flex flex-wrap gap-2">
                {HIDDEN_FIELD_DEFS.map(({ key, labelKey, icon: Icon }) => {
                  const active = hidden.has(key);
                  return (
                    <button
                      key={key}
                      onClick={() => toggleHidden(key)}
                      aria-pressed={active}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all',
                        active
                          ? 'border-primary-600 text-white bg-primary-600/10'
                          : 'border-slate-600 text-slate-400 hover:text-slate-200',
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" /> {t(labelKey)}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {saveError && <p className="text-sm text-red-400">{saveError}</p>}
      </div>
    </Sheet>
    {showShare && feedItem && (
      <FeedShareSheet item={feedItem} onClose={() => setShowShare(false)} />
    )}
    </>
  );
}
