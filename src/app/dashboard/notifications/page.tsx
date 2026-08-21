'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Bell, MessageSquare, Trophy, Flame, Calendar, Activity, ClipboardList, ChevronDown, X } from 'lucide-react';
import { useApi } from '@/lib/api';
import { SkeletonList } from '@/components/ui';
import { cn } from '@/lib/utils';

interface Item {
  id: string;
  kind: string;
  title: string;
  body: string;
  url: string;
  sentAt: string;
  unread: boolean;
}

// The iOS-style grouping buckets — same 4 categories athletes already toggle in
// NotificationPrefs (push mute prefs), plus an "other" catch-all for anything
// that doesn't match one of them (e.g. race/registration nudges).
type GroupCategory = 'workouts' | 'coach' | 'achievements' | 'program' | 'other';

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

// Hebrew relative time — "עכשיו" / "לפני N דקות/שעות/ימים".
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'עכשיו';
  if (min < 60) return `לפני ${min} דק׳`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `לפני ${hr} שע׳`;
  const d = Math.floor(hr / 24);
  if (d === 1) return 'אתמול';
  if (d < 7) return `לפני ${d} ימים`;
  return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });
}

// Icon + colored tile by notification kind / content — a light heuristic on the
// title so custom coach messages still get a sensible glyph. Colors mirror the
// design deck: coach=blue, race=gold, achievement=green, workout=indigo.
function styleFor(it: Item): { Icon: typeof Activity; bg: string; fg: string } {
  const s = it.title + ' ' + it.body;
  if (/מאמן|תשובה|💬/.test(s)) return { Icon: MessageSquare, bg: 'bg-sky-500/18', fg: 'text-sky-300' };
  if (/מרוץ|מרתון|הרשמה|🏆/.test(s)) return { Icon: Trophy, bg: 'bg-amber-500/18', fg: 'text-amber-300' };
  if (/שיא|רצף|הישג|🎉|🔥|🎖/.test(s)) return { Icon: Flame, bg: 'bg-emerald-500/18', fg: 'text-emerald-300' };
  if (/אימון|נוכחות|מגיעים/.test(s)) return { Icon: Calendar, bg: 'bg-primary-600/20', fg: 'text-primary-300' };
  return { Icon: Activity, bg: 'bg-slate-600/30', fg: 'text-slate-300' };
}

// Group category per item. `kind` cleanly maps for the two cron-generated kinds
// that always mean a workout nudge; everything else (mostly admin-composed
// `kind: 'custom'` messages, which carry no category column at all) falls back
// to the same title/body regex idiom styleFor already uses, tuned to the 4
// push-pref categories in src/lib/push.ts's NotificationCategory. Anything that
// still doesn't match (e.g. race/registration copy) lands in the "other" catch-all.
function categoryFor(it: Item): GroupCategory {
  if (it.kind === 'training_before' || it.kind === 'workout_detected') return 'workouts';
  const s = it.title + ' ' + it.body;
  if (/מאמן|תשובה|💬/.test(s)) return 'coach';
  if (/תוכנית|תוכניות|שבוע חדש|תזונה/.test(s)) return 'program';
  if (/שיא|רצף|הישג|סיכום|מרוץ|מרתון|הרשמה|🏆|🎉|🔥|🎖|🏅/.test(s)) return 'achievements';
  if (/אימון|נוכחות|מגיעים/.test(s)) return 'workouts';
  return 'other';
}

const GROUP_META: Record<GroupCategory, { Icon: typeof Activity; bg: string; fg: string }> = {
  workouts: { Icon: Calendar, bg: 'bg-primary-600/20', fg: 'text-primary-300' },
  coach: { Icon: MessageSquare, bg: 'bg-sky-500/18', fg: 'text-sky-300' },
  achievements: { Icon: Flame, bg: 'bg-emerald-500/18', fg: 'text-emerald-300' },
  program: { Icon: ClipboardList, bg: 'bg-amber-500/18', fg: 'text-amber-300' },
  other: { Icon: Activity, bg: 'bg-slate-600/30', fg: 'text-slate-300' },
};

interface Group {
  category: GroupCategory;
  items: Item[];
  newestAt: string;
  unreadCount: number;
}

// In-app notification inbox (PRD panel 5): the athlete's notification history,
// grouped by category (iOS-style collapsible sections) — unread dots + tap to
// open the linked screen. Reads /api/notifications/inbox.
export default function NotificationsInboxPage() {
  const router = useRouter();
  const tn = useTranslations('notifications');

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

  // Group by category, newest-item-first per group.
  const groups: Group[] = useMemo(() => {
    const byCategory = new Map<GroupCategory, Item[]>();
    for (const it of items) {
      const cat = categoryFor(it);
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(it);
    }
    return Array.from(byCategory.entries())
      .map(([category, groupItems]) => ({
        category,
        items: groupItems,
        newestAt: groupItems[0]?.sentAt,
        unreadCount: groupItems.filter(isUnread).length,
      }))
      .sort((a, b) => new Date(b.newestAt).getTime() - new Date(a.newestAt).getTime());
  }, [items, isUnread]);

  // Expand/collapse per category — default: expanded if the group has any
  // unread item, collapsed otherwise. Only seeded once (on first load) so the
  // athlete's manual toggles survive later SWR revalidations.
  const [openCats, setOpenCats] = useState<Set<GroupCategory>>(new Set());
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !data) return;
    seededRef.current = true;
    setOpenCats(new Set(groups.filter(g => g.unreadCount > 0).map(g => g.category)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const toggleCat = (cat: GroupCategory) => {
    setOpenCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  // Group "X" — clears the unread highlight for every currently-unread item in
  // the group. Doesn't touch the server (nothing per-notification to update
  // there); persists to localStorage so it survives a reload, same as the
  // idiom used elsewhere in the app for dismiss-style flags.
  const markGroupRead = (group: Group) => {
    const ids = group.items.filter(isUnread).map(i => i.id);
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
    <div className="max-w-2xl mx-auto" dir="rtl">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Bell className="h-6 w-6 text-primary-400" /> {tn('title')}
        </h1>
      </div>

      {loading ? (
        <SkeletonList count={5} />
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-slate-800 flex items-center justify-center">
            <Bell className="h-6 w-6 text-slate-500" />
          </div>
          <p className="text-sm text-slate-400">{tn('empty')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => {
            const meta = GROUP_META[group.category];
            const open = openCats.has(group.category);
            return (
              <div key={group.category} className="rounded-2xl border border-slate-700/60 bg-slate-800/50 overflow-hidden">
                <div className="flex items-center gap-1 bg-slate-800/80">
                  <button
                    type="button"
                    onClick={() => toggleCat(group.category)}
                    aria-expanded={open}
                    className="flex-1 flex items-center gap-2 px-3.5 py-2.5 text-start min-w-0"
                  >
                    <span className={`w-7 h-7 rounded-lg ${meta.bg} flex items-center justify-center shrink-0`}>
                      <meta.Icon className={`h-3.5 w-3.5 ${meta.fg}`} />
                    </span>
                    <span className="flex-1 min-w-0 flex items-baseline gap-1.5">
                      <span className="text-sm font-bold text-white truncate">{tn(`categories.${group.category}`)}</span>
                      <span className="text-2xs text-slate-500 tabular-nums shrink-0">{group.items.length}</span>
                      {group.unreadCount > 0 && (
                        <span className="w-1.5 h-1.5 rounded-full bg-primary-500 shrink-0" aria-hidden="true" />
                      )}
                    </span>
                    <span className="flex items-center gap-1 text-2xs font-semibold text-slate-400 shrink-0">
                      {open ? tn('showLess') : tn('showMore')}
                      <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
                    </span>
                  </button>
                  {group.unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={() => markGroupRead(group)}
                      className="p-2 me-2 rounded-lg text-slate-500 hover:text-white hover:bg-slate-700/60 transition-colors shrink-0"
                      aria-label={tn('markGroupRead')}
                      title={tn('markGroupRead')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {open && (
                  <div className="divide-y divide-slate-700/60 border-t border-slate-700/60">
                    {group.items.map((it) => {
                      const { Icon, bg, fg } = styleFor(it);
                      const unread = isUnread(it);
                      return (
                        <button
                          key={it.id}
                          onClick={() => router.push(it.url || '/dashboard')}
                          className="w-full flex items-start gap-3 p-3.5 text-start active:bg-slate-700/40 transition-colors relative"
                        >
                          {unread && <span className="absolute start-1 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-primary-500" aria-hidden="true" />}
                          <span className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center shrink-0`}>
                            <Icon className={`h-5 w-5 ${fg}`} />
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-2">
                              <span className={`text-sm truncate ${unread ? 'font-bold text-white' : 'font-semibold text-slate-200'}`} dir="auto">{it.title}</span>
                              <span className="text-2xs text-slate-500 ms-auto shrink-0 whitespace-nowrap">{timeAgo(it.sentAt)}</span>
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5 line-clamp-2" dir="auto">{it.body}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
