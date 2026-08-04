'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, MessageSquare, Trophy, Flame, Calendar, Activity } from 'lucide-react';
import { useApi } from '@/lib/api';
import { SkeletonList } from '@/components/ui';

interface Item {
  id: string;
  kind: string;
  title: string;
  body: string;
  url: string;
  sentAt: string;
  unread: boolean;
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

// In-app notification inbox (PRD panel 5): the athlete's notification history —
// unread dots + tap to open the linked screen. Reads /api/notifications/inbox.
export default function NotificationsInboxPage() {
  const router = useRouter();

  // athleteId comes from localStorage (client-only); resolve on mount so the SWR
  // key is SSR-safe. null = not yet resolved, '' = resolved but no athlete.
  const [athleteId, setAthleteId] = useState<string | null>(null);
  useEffect(() => { setAthleteId(localStorage.getItem('athlete_id') || ''); }, []);

  const { data } = useApi<{ items?: Item[] }>(
    athleteId ? `/api/notifications/inbox?athleteId=${encodeURIComponent(athleteId)}` : null,
  );
  const items = data?.items || [];
  const loading = athleteId === null || (!!athleteId && !data);

  return (
    <div className="max-w-2xl mx-auto" dir="rtl">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Bell className="h-6 w-6 text-primary-400" /> התראות
        </h1>
      </div>

      {loading ? (
        <SkeletonList count={5} />
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-slate-800 flex items-center justify-center">
            <Bell className="h-6 w-6 text-slate-500" />
          </div>
          <p className="text-sm text-slate-400">אין התראות עדיין</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-700/60 bg-slate-800/50 overflow-hidden divide-y divide-slate-700/60">
          {items.map((it) => {
            const { Icon, bg, fg } = styleFor(it);
            return (
              <button
                key={it.id}
                onClick={() => router.push(it.url || '/dashboard')}
                className="w-full flex items-start gap-3 p-3.5 text-start active:bg-slate-700/40 transition-colors relative"
              >
                {it.unread && <span className="absolute start-1 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-primary-500" aria-hidden="true" />}
                <span className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center shrink-0`}>
                  <Icon className={`h-5 w-5 ${fg}`} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className={`text-sm truncate ${it.unread ? 'font-bold text-white' : 'font-semibold text-slate-200'}`} dir="auto">{it.title}</span>
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
}
