'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Loader2, MessageSquare, Trophy, Flame, Calendar, Activity } from 'lucide-react';

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

// Icon by notification kind / content — a light heuristic on the title so custom
// coach messages still get a sensible glyph.
function iconFor(it: Item) {
  if (/מאמן|תשובה|💬/.test(it.title + it.body)) return MessageSquare;
  if (/מרוץ|מרתון|הרשמה|🏆/.test(it.title + it.body)) return Trophy;
  if (/שיא|רצף|הישג|🎉|🔥/.test(it.title + it.body)) return Flame;
  if (/אימון|נוכחות|מגיעים/.test(it.title + it.body)) return Calendar;
  return Activity;
}

// In-app notification inbox (PRD panel 5): the athlete's notification history —
// unread dots + tap to open the linked screen. Reads /api/notifications/inbox.
export default function NotificationsInboxPage() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const id = localStorage.getItem('athlete_id') || '';
    if (!id) { setLoading(false); return; }
    fetch(`/api/notifications/inbox?athleteId=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setItems(d?.items || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-2xl mx-auto" dir="rtl">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Bell className="h-6 w-6 text-primary-400" /> התראות
        </h1>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 text-primary-500 animate-spin" /></div>
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
            const Icon = iconFor(it);
            return (
              <button
                key={it.id}
                onClick={() => router.push(it.url || '/dashboard')}
                className="w-full flex items-start gap-3 p-3.5 text-start active:bg-slate-700/40 transition-colors relative"
              >
                {it.unread && <span className="absolute start-1 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-primary-500" aria-hidden="true" />}
                <span className="w-10 h-10 rounded-xl bg-primary-600/18 flex items-center justify-center shrink-0">
                  <Icon className="h-5 w-5 text-primary-300" />
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
