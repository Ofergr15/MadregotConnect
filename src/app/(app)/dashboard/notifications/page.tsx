'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { Bell, MessageSquare, Trophy, Flame, Calendar, Activity, CheckCheck, ThumbsUp, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApi, apiHeaders } from '@/lib/api';
import { SkeletonList, EmptyState, InsetSection, InsetRow } from '@/components/ui';
import {
  type HistoryItem as Item,
  type DateBucket,
  DATE_BUCKETS,
  dateBucketFor,
  readStoreKey,
  styleKindFor,
  kudosActivityId,
  rsvpTarget,
} from '@/lib/notifications/history';

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

// Icon + colored tile per styleKindFor's content heuristic (see
// src/lib/notifications/history.ts). `tile` is the solid-color variant used
// for the InsetRow icon tile (white icon on a solid bg, the app-wide
// InsetRow convention).
const STYLE_BY_KIND: Record<ReturnType<typeof styleKindFor>, { Icon: typeof Activity; tile: string }> = {
  coach: { Icon: MessageSquare, tile: 'bg-band-2' },
  race: { Icon: Trophy, tile: 'bg-band-3' },
  achievement: { Icon: Flame, tile: 'bg-accent-600' },
  workout: { Icon: Calendar, tile: 'bg-brand-600' },
  default: { Icon: Activity, tile: 'bg-ink-300' },
};
function styleFor(it: Item): { Icon: typeof Activity; tile: string } {
  return STYLE_BY_KIND[styleKindFor(it)];
}

interface Section {
  bucket: DateBucket;
  items: Item[];
}

// Inline RSVP yes/no on a training_before row — loads the athlete's current
// answer (if any) so the row reflects reality even after a reload, then
// toggles optimistically on tap, same posture as KudosButton above.
function RsvpInlineButtons({ weekStart, day, athleteId }: { weekStart: string; day: number; athleteId: string }) {
  const [attending, setAttending] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiHeaders()
      .then(h => fetch(`/api/attendance?weekStart=${weekStart}&day=${day}&athleteId=${athleteId}`, { headers: h }))
      .then(r => (r.ok ? r.json() : null))
      .then(data => { if (data?.rsvp) setAttending(data.rsvp.attending); })
      .catch(() => {});
  }, [weekStart, day, athleteId]);

  const submit = async (e: React.MouseEvent, next: boolean) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    const prev = attending;
    setAttending(next);
    try {
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: await apiHeaders(true),
        body: JSON.stringify({ athleteId, weekStart, day, attending: next }),
      });
      if (!res.ok) throw new Error();
    } catch { setAttending(prev); }
    setBusy(false);
  };

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <button
        type="button"
        onClick={(e) => submit(e, true)}
        className={cn(
          'flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold transition-colors',
          attending === true ? 'bg-brand-600 text-white' : 'bg-page/60 text-ink-500 hover:bg-ink-300/40',
        )}
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={(e) => submit(e, false)}
        className={cn(
          'flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold transition-colors',
          attending === false ? 'bg-ink-300 text-ink-700' : 'bg-page/60 text-ink-500 hover:bg-ink-300/40',
        )}
      >
        <XCircle className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// Inline "give kudos" action on a kudos_activity row. Fetches the athlete's
// real prior state on mount — previously this always started assuming
// not-yet-given, which meant kudos already given via the OS push notification's
// own action button (src/app/sw.ts) looked un-given here; a first tap was a
// harmless no-op re-confirming it, but a second tap (e.g. an accidental
// double-tap, or tapping again because the first tap visibly did nothing new)
// sent a real DELETE and silently removed a genuine prior reaction.
function KudosButton({ activityId, athleteId }: { activityId: string; athleteId: string }) {
  const [given, setGiven] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/activities/${activityId}/kudos?athleteId=${encodeURIComponent(athleteId)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setGiven(!!data.givenByMe); })
      .catch(() => {});
  }, [activityId, athleteId]);

  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    const next = !given;
    setGiven(next);
    try {
      await fetch(`/api/activities/${activityId}/kudos`, {
        method: next ? 'POST' : 'DELETE',
        headers: await apiHeaders(true),
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
        given ? 'bg-brand-600 text-white' : 'bg-page/60 text-ink-500 hover:bg-ink-300/40',
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
        <h1 className="text-2xl font-bold text-ink-700 flex items-center gap-2">
          <Bell className="h-6 w-6 text-brand-600" /> {tn('title')}
        </h1>
        {totalUnread > 0 && (
          <button
            type="button"
            onClick={markAllRead}
            className="flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg text-xs font-semibold text-brand-600 hover:text-ink-900 hover:bg-page/60 transition-colors"
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
                const rsvp = rsvpTarget(it);
                return (
                  <div key={it.id} className="relative">
                    {unread && <span className="absolute start-1.5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-brand-600 z-10" aria-hidden="true" />}
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
                            <span className="text-xs text-ink-400 shrink-0">{timeAgo(it.sentAt, tn, dateLocale)}</span>
                            <KudosButton activityId={kudosId} athleteId={athleteId} />
                          </div>
                        ) : rsvp && athleteId ? (
                          <div className="flex flex-col items-end gap-1.5">
                            <span className="text-xs text-ink-400 shrink-0">{timeAgo(it.sentAt, tn, dateLocale)}</span>
                            <RsvpInlineButtons weekStart={rsvp.weekStart} day={rsvp.day} athleteId={athleteId} />
                          </div>
                        ) : undefined
                      }
                      value={(kudosId || rsvp) ? undefined : timeAgo(it.sentAt, tn, dateLocale)}
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
