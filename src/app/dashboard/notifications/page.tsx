'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { Bell, MessageSquare, Trophy, Flame, Calendar, Activity, CheckCheck, ThumbsUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { SkeletonList, EmptyState, InsetSection, InsetRow } from '@/components/ui';

interface Item {
  id: string;
  kind: string;
  title: string;
  body: string;
  url: string;
  sentAt: string;
  unread: boolean;
  actorName?: string | null;
  actorAvatarUrl?: string | null;
}

// Real native notification-history UIs are a static chronological list —
// you can't collapse "Today". Date bucket is the section; category (via
// styleFor below) is now only a per-row icon/color, not a grouping axis.
type DateBucket = 'today' | 'yesterday' | 'thisWeek' | 'older';
const DATE_BUCKETS: DateBucket[] = ['today', 'yesterday', 'thisWeek', 'older'];

function dateBucketFor(iso: string): DateBucket {
  const then = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 7);
  if (then >= startOfToday) return 'today';
  if (then >= startOfYesterday) return 'yesterday';
  if (then >= startOfWeek) return 'thisWeek';
  return 'older';
}

// localStorage key for this athlete's locally-dismissed (group "X") notification
// ids. There's no per-notification read column in the DB — the server's `unread`
// flag is derived from a single athletes.last_seen_at cutoff (see inbox route),
// so per-group "mark read" has nothing server-side to toggle. Persisting the
// dismissed ids client-side (same pattern as the app's other *_dismissed flags,
// e.g. pwa_install_dismissed) lets the group X clear the highlight without
// deleting history, and without a new DB table just for this.
function readStoreKey(athleteId: string): string {
  return `notif_read_ids_${athleteId}`;
}

// Locale-aware relative time — "now" / "N min/hours/days ago" — routed through
// next-intl (`t`) instead of a hardcoded Hebrew table, so an English-locale
// athlete sees English timestamps.
function timeAgo(iso: string, t: (key: string, values?: Record<string, number>) => string, dateLocale: string): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const min = Math.floor(diff / 60000);
  if (min < 1) return t('justNow');
  if (min < 60) return t('minutesAgo', { count: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t('hoursAgo', { count: hr });
  const d = Math.floor(hr / 24);
  if (d === 1) return t('yesterday');
  if (d < 7) return t('daysAgo', { count: d });
  return new Date(iso).toLocaleDateString(dateLocale, { day: 'numeric', month: 'short' });
}

// Icon + colored tile by notification kind / content — a light heuristic on the
// title so custom coach messages still get a sensible glyph. Colors mirror the
// design deck: coach=blue, race=gold, achievement=green, workout=indigo.
// `tile` is the solid-color variant used for the InsetRow icon tile (white
// icon on a solid bg, the app-wide InsetRow convention).
function styleFor(it: Item): { Icon: typeof Activity; tile: string } {
  const s = it.title + ' ' + it.body;
  if (/מאמן|תשובה|💬/.test(s)) return { Icon: MessageSquare, tile: 'bg-sky-500' };
  if (/מרוץ|מרתון|הרשמה|🏆/.test(s)) return { Icon: Trophy, tile: 'bg-amber-500' };
  if (/שיא|רצף|הישג|🎉|🔥|🎖/.test(s)) return { Icon: Flame, tile: 'bg-emerald-500' };
  if (/אימון|נוכחות|מגיעים/.test(s)) return { Icon: Calendar, tile: 'bg-primary-600' };
  return { Icon: Activity, tile: 'bg-slate-500' };
}

interface Section {
  bucket: DateBucket;
  items: Item[];
}

// "kudos_activity" rows carry the real activity id as a ?kudos= query param
// (see notifyTeammatesOfActivity in src/lib/push.ts) so kudos can be given
// directly from the notification, with no teammate-visible activity-detail
// page needed at all.
function kudosActivityId(it: Item): string | null {
  if (it.kind !== 'kudos_activity') return null;
  const m = it.url.match(/[?&]kudos=([^&]+)/);
  return m ? m[1] : null;
}

// Inline "give kudos" action on a kudos_activity row — optimistic, starts
// assuming not-yet-given (a page reload always resets it; acceptable for a
// low-stakes one-tap reaction, same as Strava's own kudos button behaves).
function KudosButton({ activityId, athleteId }: { activityId: string; athleteId: string }) {
  const [given, setGiven] = useState(false);
  const [busy, setBusy] = useState(false);
  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    const next = !given;
    setGiven(next);
    try {
      await fetch(`/api/activities/${activityId}/kudos`, {
        method: next ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ athleteId }),
      });
    } catch { setGiven(!next); } // revert on failure
    setBusy(false);
  };
  return (
    <button
      type="button"
      onClick={toggle}
      className={cn(
        'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0',
        given ? 'bg-primary-600 text-white' : 'bg-slate-700/60 text-slate-300 hover:bg-slate-700',
      )}
    >
      <ThumbsUp className="h-3.5 w-3.5" /> {given ? 'ניתן' : 'קודוס'}
    </button>
  );
}

// In-app notification inbox (PRD panel 5): the athlete's notification history,
// grouped by date (Today / Yesterday / This week / Older — a static
// chronological list, no collapsing) — unread dots + tap to open the linked
// screen. Reads /api/notifications/inbox.
export default function NotificationsInboxPage() {
  const router = useRouter();
  const tn = useTranslations('notifications');
  const locale = useLocale();
  const dateLocale = locale === 'he' ? 'he-IL' : 'en-US';

  // athleteId comes from localStorage (client-only); resolve on mount so the SWR
  // key is SSR-safe. null = not yet resolved, '' = resolved but no athlete.
  const [athleteId, setAthleteId] = useState<string | null>(null);
  useEffect(() => { setAthleteId(localStorage.getItem('athlete_id') || ''); }, []);

  const { data } = useApi<{ items?: Item[] }>(
    athleteId ? `/api/notifications/inbox?athleteId=${encodeURIComponent(athleteId)}` : null,
  );
  const items = useMemo(() => data?.items || [], [data]);
  const loading = athleteId === null || (!!athleteId && !data);

  // Locally-dismissed ids (group "X" target) — see readStoreKey() above.
  const [clearedIds, setClearedIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!athleteId) return;
    try {
      const raw = localStorage.getItem(readStoreKey(athleteId));
      if (raw) setClearedIds(new Set(JSON.parse(raw)));
    } catch { /* corrupt/missing storage — start clean */ }
  }, [athleteId]);

  const isUnread = useCallback((it: Item) => it.unread && !clearedIds.has(it.id), [clearedIds]);
  const totalUnread = useMemo(() => items.filter(isUnread).length, [items, isUnread]);

  // Static date sections, newest-item-first within each — no collapsing, so
  // the page never looks empty just because everything's already read.
  const sections: Section[] = useMemo(() => {
    const byBucket = new Map<DateBucket, Item[]>();
    for (const it of items) {
      const b = dateBucketFor(it.sentAt);
      if (!byBucket.has(b)) byBucket.set(b, []);
      byBucket.get(b)!.push(it);
    }
    return DATE_BUCKETS
      .filter(b => byBucket.has(b))
      .map(bucket => ({ bucket, items: byBucket.get(bucket)! }));
  }, [items]);

  // Single "mark all read" action, replacing the old per-category button —
  // clears every currently-unread item at once. Doesn't touch the server
  // (nothing per-notification to update there); persists to localStorage so
  // it survives a reload, same idiom the app uses for other dismiss flags.
  const markAllRead = () => {
    const ids = items.filter(isUnread).map(i => i.id);
    if (ids.length === 0) return;
    setClearedIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.add(id));
      // Prune ids that fell out of the current (max 50) inbox window so
      // storage can't grow unbounded across months of use.
      const currentIds = new Set(items.map(i => i.id));
      const pruned = new Set([...next].filter(id => currentIds.has(id)));
      if (athleteId) {
        try { localStorage.setItem(readStoreKey(athleteId), JSON.stringify([...pruned])); } catch { /* best-effort */ }
      }
      return pruned;
    });
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Bell className="h-6 w-6 text-primary-400" /> {tn('title')}
        </h1>
        {totalUnread > 0 && (
          <button
            type="button"
            onClick={markAllRead}
            className="flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg text-xs font-semibold text-primary-300 hover:text-white hover:bg-slate-700/60 transition-colors"
          >
            <CheckCheck className="h-3.5 w-3.5" /> {tn('markAllRead')}
          </button>
        )}
      </div>

      {loading ? (
        <SkeletonList count={5} />
      ) : items.length === 0 ? (
        <EmptyState icon={Bell} title={tn('empty')} />
      ) : (
        <div className="space-y-5">
          {sections.map(({ bucket, items: sectionItems }) => (
            <InsetSection key={bucket} header={tn(`dateSections.${bucket}`)}>
              {sectionItems.map((it) => {
                const { Icon, tile } = styleFor(it);
                const unread = isUnread(it);
                const kudosId = kudosActivityId(it);
                return (
                  <div key={it.id} className="relative">
                    {unread && <span className="absolute start-1.5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-primary-500 z-10" aria-hidden="true" />}
                    <InsetRow
                      icon={Icon}
                      iconBg={tile}
                      avatarUrl={it.actorAvatarUrl || undefined}
                      label={it.title}
                      sublabel={it.body}
                      onClick={() => router.push(it.url || '/dashboard')}
                      trailing={
                        kudosId && athleteId ? (
                          <div className="flex flex-col items-end gap-1.5">
                            <span className="text-xs text-slate-400 shrink-0">{timeAgo(it.sentAt, tn, dateLocale)}</span>
                            <KudosButton activityId={kudosId} athleteId={athleteId} />
                          </div>
                        ) : undefined
                      }
                      value={kudosId ? undefined : timeAgo(it.sentAt, tn, dateLocale)}
                    />
                  </div>
                );
              })}
            </InsetSection>
          ))}
        </div>
      )}
    </div>
  );
}
