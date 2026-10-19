'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { Bell, MessageSquare, Trophy, Flame, Calendar, Activity, CheckCheck, ThumbsUp, CheckCircle2, XCircle, SlidersHorizontal, Footprints, Archive, Bug, Gauge } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApi, apiHeaders } from '@/lib/api';
import { useAthleteId } from '@/lib/use-athlete-id';
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
  foldInbox,
  foldNames,
  isClubItem,
  waitingFor,
  closedSurveyIds,
  broadcastCopyIds,
} from '@/lib/notifications/history';
import { TomorrowSession } from '@/components/home/TomorrowCard';

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

// Inline RSVP yes/no on a training_before row — shows the athlete's current
// answer (if any) so the row reflects reality even after a reload, then
// toggles optimistically on tap, same posture as KudosButton above.
function RsvpInlineButtons({
  weekStart,
  day,
  athleteId,
  initialAttending,
}: { weekStart: string; day: number; athleteId: string; initialAttending?: boolean | null }) {
  // The two buttons are icon-only, so their names come from the same copy the
  // full-size attendance card uses ("מגיע/ה" / "לא הפעם") rather than new
  // strings — one answer, one wording, wherever the athlete is asked.
  const ta = useTranslations('attendance');
  const [attending, setAttending] = useState<boolean | null>(initialAttending ?? null);
  const [busy, setBusy] = useState(false);

  // The inbox response carries the answer (see withRowActions in the inbox
  // route), so normally this costs nothing. The fetch is the fallback for when
  // it didn't come through — a response cached before that existed, or the
  // batched lookup having failed — because a week's reminders used to fire one
  // of these requests each, and every one of them re-verified the session.
  useEffect(() => {
    if (initialAttending !== undefined) {
      setAttending(initialAttending);
      return;
    }
    apiHeaders()
      .then(h => fetch(`/api/attendance?weekStart=${weekStart}&day=${day}&athleteId=${athleteId}`, { headers: h }))
      .then(r => (r.ok ? r.json() : null))
      .then(data => { if (data?.rsvp) setAttending(data.rsvp.attending); })
      .catch(() => {});
  }, [weekStart, day, athleteId, initialAttending]);

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
    // Both buttons measured 28×24px: an icon with `px-2 py-1.5` around it and
    // nothing else, which is barely half the 44px floor in each direction — and
    // they sit 6px apart, so the yes and the no were two adjacent 24px-tall
    // strips and a thumb answering a reminder had a real chance of sending the
    // opposite answer. `w-11 h-11` is the floor exactly; the icons stay 14px, so
    // only the hit area grows.
    //
    // They also had no accessible name at all (an icon-only <button> with no
    // aria-label announces as "button"), which on this row means a screen-reader
    // user was offered two identical unnamed buttons that commit to opposite
    // answers.
    <div className="flex items-center gap-1.5 shrink-0">
      <button
        type="button"
        onClick={(e) => submit(e, true)}
        aria-label={ta('coming')}
        aria-pressed={attending === true}
        title={ta('coming')}
        className={cn(
          'flex w-11 h-11 items-center justify-center rounded-lg transition-colors',
          attending === true ? 'bg-brand-600 text-white' : 'bg-page/60 text-ink-500 hover:bg-ink-300/40',
        )}
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={(e) => submit(e, false)}
        aria-label={ta('notComing')}
        aria-pressed={attending === false}
        title={ta('notComing')}
        className={cn(
          'flex w-11 h-11 items-center justify-center rounded-lg transition-colors',
          attending === false ? 'bg-ink-300 text-ink-700' : 'bg-page/60 text-ink-500 hover:bg-ink-300/40',
        )}
      >
        <XCircle className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// Inline "give kudos" action on a kudos_activity row. Needs the athlete's real
// prior state: it once always started assuming not-yet-given, which meant kudos
// already given via the OS push notification's own action button (src/app/sw.ts)
// looked un-given here; a first tap was a harmless no-op re-confirming it, but a
// second tap (e.g. an accidental double-tap, or tapping again because the first
// tap visibly did nothing new) sent a real DELETE and silently removed a genuine
// prior reaction.
//
// That state now arrives with the inbox row (see withRowActions in the inbox
// route) instead of a fetch per button — the fan-out that made this page slow,
// since a normal window is 40+ kudos rows. The fetch stays as the fallback for
// a response that didn't carry it, because being right here matters more than
// being fast.
function KudosButton({
  activityId,
  athleteId,
  initialGiven,
}: { activityId: string; athleteId: string; initialGiven?: boolean }) {
  const [given, setGiven] = useState(!!initialGiven);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initialGiven !== undefined) {
      setGiven(initialGiven);
      return;
    }
    fetch(`/api/activities/${activityId}/kudos?athleteId=${encodeURIComponent(athleteId)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setGiven(!!data.givenByMe); })
      .catch(() => {});
  }, [activityId, athleteId, initialGiven]);

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
      aria-pressed={given}
      // 56×28px before: the text gave it enough width, but `py-1.5` around 14px
      // type is 28px of height on the one control that toggles a real reaction
      // on somebody else's run — and an accidental second tap here sends a
      // DELETE (see the note above). `min-h-[44px]` with `-my-1` grows it into
      // InsetRow's own `py-3` the way the feedback list's AthleteLink does, so
      // the thumb target reaches the floor without the row getting taller.
      className={cn(
        'flex items-center gap-1 px-2.5 min-h-[44px] -my-1 rounded-lg text-xs font-semibold transition-colors shrink-0',
        given ? 'bg-brand-600 text-white' : 'bg-page/60 text-ink-500 hover:bg-ink-300/40',
      )}
    >
      <ThumbsUp className="h-3.5 w-3.5" /> {given ? 'ניתן' : 'כיף'}
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

  // Known on the FIRST render, not after a mount effect — this is the screen
  // 41b26dca was reported from, and the reason it showed a spinner on every open
  // was that a null SWR key on render #1 gave the persisted cache nothing to
  // paint. See src/lib/use-athlete-id.ts. '' = no athlete row.
  const athleteId = useAthleteId();

  const { data } = useApi<{ items?: Item[] }>(
    athleteId ? `/api/notifications/inbox?athleteId=${encodeURIComponent(athleteId)}` : null,
  );
  const allItems = useMemo(() => data?.items || [], [data]);
  // Two tabs: what is about you, and what happened in the club (isClubItem).
  const [tab, setTab] = useState<'you' | 'club'>('you');
  // What is asked of the athlete goes on top, and the polls past answering fold away at
  // the bottom (lib/notifications/history waitingFor / closedSurveyIds, 2026-10-19).
  const waiting = useMemo(() => waitingFor(allItems), [allItems]);
  const closedSurveys = useMemo(() => closedSurveyIds(allItems), [allItems]);
  const copies = useMemo(() => broadcastCopyIds(allItems), [allItems]);
  const items = useMemo(
    () => allItems.filter((it) => isClubItem(it) === (tab === 'club') && !waiting.hidden.has(it.id) && !closedSurveys.has(it.id) && !copies.has(it.id)),
    [allItems, tab, waiting, closedSurveys, copies],
  );
  const oldSurveys = useMemo(() => allItems.filter((it) => closedSurveys.has(it.id)), [allItems, closedSurveys]);
  const hasWaiting = tab === 'you' && (!!waiting.rsvp || !!waiting.prompt);
  const loading = !!athleteId && !data;

  // Locally-dismissed ids (group "X" target) — see readStoreKey() above. Read in
  // the initializer for the same reason as athleteId: now that the list can paint
  // from cache on the first frame, loading this one commit later would flash every
  // already-read row as unread.
  const [clearedIds, setClearedIds] = useState<Set<string>>(() => {
    if (!athleteId) return new Set();
    try {
      const raw = localStorage.getItem(readStoreKey(athleteId));
      return raw ? new Set<string>(JSON.parse(raw)) : new Set();
    } catch {
      return new Set(); // corrupt/missing storage — start clean
    }
  });

  const isUnread = useCallback((it: Item) => it.unread && !clearedIds.has(it.id), [clearedIds]);
  const totalUnread = useMemo(() => items.filter(isUnread).length, [items, isUnread]);
  const unreadOf = (club: boolean) => allItems.filter((it) => isClubItem(it) === club && isUnread(it)).length;

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

  // Which folded days of runs are open (foldRuns). Session-only.
  const [openFolds, setOpenFolds] = useState<Set<string>>(() => new Set());

  const toggleFold = (key: string) => setOpenFolds((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const renderRow = (it: Item, note?: string) => {
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
          sublabel={note ? [it.body, note].filter(Boolean).join(' · ') : it.body}
          // Here the sublabel IS the notification — the body of the
          // coach's reply, the workout the reminder is about — and
          // one truncated line showed a quarter of it: a reply
          // needing 650px got 185px at 393px, and at 375px even
          // "מגיעים? האימון מתחיל ב-19:00 באצטדיון" was cut. Two
          // lines, still bounded. Same for the title above it, which
          // is the sentence the athlete actually reads.
          sublabelClamp
          labelClamp
          onClick={() => router.push(it.url || '/dashboard')}
          trailing={
            kudosId && athleteId ? (
              <div className="flex flex-col items-end gap-1.5">
                <span className="text-xs text-ink-400 shrink-0">{timeAgo(it.sentAt, tn, dateLocale)}</span>
                <KudosButton activityId={kudosId} athleteId={athleteId} initialGiven={it.kudosGiven} />
              </div>
            ) : rsvp && athleteId ? (
              <div className="flex flex-col items-end gap-1.5">
                <span className="text-xs text-ink-400 shrink-0">{timeAgo(it.sentAt, tn, dateLocale)}</span>
                <RsvpInlineButtons
                  weekStart={rsvp.weekStart}
                  day={rsvp.day}
                  athleteId={athleteId}
                  initialAttending={it.rsvpAttending}
                />
              </div>
            ) : undefined
          }
          value={(kudosId || rsvp) ? undefined : timeAgo(it.sentAt, tn, dateLocale)}
        />
      </div>
    );
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink-700 flex items-center gap-2">
          <Bell className="h-6 w-6 text-brand-600" /> {tn('title')}
        </h1>
        <div className="flex items-center gap-1">
          {totalUnread > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg text-xs font-semibold text-brand-600 hover:text-ink-900 hover:bg-page/60 transition-colors"
            >
              <CheckCheck className="h-3.5 w-3.5" /> {tn('markAllRead')}
            </button>
          )}
          {/* The per-category toggles have always lived on the profile, but this
              inbox is where somebody goes when they want fewer of these — so it
              needs the way out. Icon-only to keep the header from wrapping next
              to "mark all read"; the accessible name carries the meaning. */}
          <Link
            href="/dashboard/profile?tab=notifications"
            aria-label={tn('managePrefs')}
            title={tn('managePrefs')}
            className="flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg text-ink-400 hover:text-ink-900 hover:bg-page/60 transition-colors"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <div role="tablist" className="mb-4 grid grid-cols-2 rounded-xl bg-page/80 p-1">
        {(['you', 'club'] as const).map((k) => {
          const n = unreadOf(k === 'club');
          return (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cn('flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg text-sm font-extrabold transition', tab === k ? 'bg-card text-ink-900 shadow-sm' : 'text-ink-500')}
            >
              {k === 'you' ? tn('tabYou') : tn('tabClub')}
              {n > 0 && <span className="min-w-[18px] rounded-full bg-accent-red px-1.5 text-2xs font-bold leading-[18px] text-white tabular-nums">{n > 99 ? '99+' : n}</span>}
            </button>
          );
        })}
      </div>

      {loading ? (
        <SkeletonList count={5} />
      ) : items.length === 0 && !hasWaiting && !(tab === 'you' && oldSurveys.length) ? (
        <EmptyState icon={Bell} title={tab === 'club' ? tn('emptyClub') : tn('emptyYou')} />
      ) : (
        <div className="space-y-5">
          {hasWaiting && (
            <section className="space-y-2.5">
              <h2 className="px-1 text-xs font-extrabold text-ink-500">{tn('waitingTitle')}</h2>
              {waiting.rsvp && <TomorrowSession weekStart={waiting.rsvp.weekStart} day={waiting.rsvp.day} />}
              {waiting.prompt && (
                <div className="rounded-[22px] bg-card px-4 py-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                  <button type="button" onClick={() => router.push(waiting.prompt!.url)} className="flex w-full items-center gap-3 text-start">
                    <span className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-[#8A5A00]"><Gauge className="h-[18px] w-[18px] text-white" /></span>
                    <span className="min-w-0 flex-1">
                      <b className="block text-[14.5px] text-ink-900">{waiting.prompt.title}</b>
                      <span className="block text-xs text-ink-500">{waiting.prompt.body}</span>
                    </span>
                  </button>
                  <div className="mt-2.5 flex items-center gap-1.5">
                    {['😣', '😕', '😐', '🙂', '😄'].map((f, i) => (
                      <Link key={i} href={`${waiting.prompt!.url}&feel=${i}`} aria-label={tn('feelN', { n: i + 1 })}
                        className="grid h-10 w-10 place-items-center rounded-xl bg-page/70 text-xl">{f}</Link>
                    ))}
                    <span className="ms-auto text-xs text-ink-400">{tn('howWasIt')}</span>
                  </div>
                </div>
              )}
            </section>
          )}
          {sections.map(({ bucket, items: sectionItems }) => (
            <InsetSection key={bucket} header={tn(`dateSections.${bucket}`)}>
              {foldInbox(sectionItems).map((entry) => {
                if (entry.type === 'item') return renderRow(entry.item);
                if (entry.type === 'repeat') return renderRow(entry.item, tn('repeated', { n: entry.count }));
                if (entry.type === 'group') {
                  const open = openFolds.has(entry.key);
                  const unread = entry.items.some(isUnread);
                  const names = foldNames(entry.items);
                  const label = entry.kind === 'likes'
                    ? tn('likesFolded', { name: (entry.items[0].actorName || '').trim() || names[0] || '', n: entry.items.length - 1 })
                    : tn('reportsFolded', { n: entry.items.length });
                  const sub = entry.kind === 'likes'
                    ? names.slice(1, 4).join(', ')
                    : entry.items.map((x) => (x.title.match(/#\d+/) || [''])[0]).filter(Boolean).join(' · ');
                  return (
                    <div key={entry.key}>
                      <div className="relative">
                        {unread && <span className="absolute start-1.5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-brand-600 z-10" aria-hidden="true" />}
                        <InsetRow
                          icon={entry.kind === 'likes' ? ThumbsUp : Bug}
                          iconBg={entry.kind === 'likes' ? 'bg-accent-600' : 'bg-band-2'}
                          avatarUrl={entry.kind === 'likes' ? entry.items[0].actorAvatarUrl || undefined : undefined}
                          label={label}
                          sublabel={[sub, open ? tn('runsClose') : tn('runsOpen')].filter(Boolean).join(' · ')}
                          labelClamp
                          sublabelClamp
                          onClick={() => toggleFold(entry.key)}
                          value={timeAgo(entry.items[0].sentAt, tn, dateLocale)}
                        />
                      </div>
                      {open && <div className="border-s-2 border-page ms-4">{entry.items.map((x) => renderRow(x))}</div>}
                    </div>
                  );
                }
                // A day of "X finished a run", folded (lib/notifications/history foldRuns).
                const open = openFolds.has(entry.key);
                const names = foldNames(entry.items);
                const more = names.length - 3;
                const unread = entry.items.some(isUnread);
                return (
                  <div key={entry.key}>
                    <div className="relative">
                      {unread && <span className="absolute start-1.5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-brand-600 z-10" aria-hidden="true" />}
                      <InsetRow
                        icon={Footprints}
                        iconBg="bg-ink-300"
                        label={tn('runsFolded', { n: entry.items.length })}
                        sublabel={[names.length ? `${names.slice(0, 3).join(', ')}${more > 0 ? ` ${tn('runsMore', { n: more })}` : ''}` : '', open ? tn('runsClose') : tn('runsOpen')].filter(Boolean).join(' · ')}
                        labelClamp
                        sublabelClamp
                        onClick={() => toggleFold(entry.key)}
                        value={timeAgo(entry.items[0].sentAt, tn, dateLocale)}
                      />
                    </div>
                    {open && <div className="border-s-2 border-page ms-4">{entry.items.map((x) => renderRow(x))}</div>}
                  </div>
                );
              })}
            </InsetSection>
          ))}
          {tab === 'you' && oldSurveys.length > 0 && (
            <InsetSection>
              <InsetRow
                icon={Archive}
                iconBg="bg-ink-300"
                label={tn('surveysClosed', { n: oldSurveys.length })}
                sublabel={[tn('surveysClosedSub', { date: new Date(oldSurveys[oldSurveys.length - 1].sentAt).toLocaleDateString(dateLocale, { day: 'numeric', month: 'numeric' }) }), openFolds.has('surveys') ? tn('runsClose') : tn('runsOpen')].join(' · ')}
                onClick={() => toggleFold('surveys')}
              />
              {openFolds.has('surveys') && <div className="border-s-2 border-page ms-4 opacity-60">{oldSurveys.map((x) => renderRow(x, tn('closedTag')))}</div>}
            </InsetSection>
          )}
        </div>
      )}
    </div>
  );
}
