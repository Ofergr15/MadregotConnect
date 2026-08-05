'use client';

import { useState, useEffect } from 'react';
import { Calendar, MessageSquare, Flame, ClipboardList } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/api';

type Category = 'workouts' | 'coach' | 'achievements' | 'program';
type Prefs = Record<Category, boolean>;

// The toggleable categories, with a colored glyph + Hebrew label, matching the
// push categories in src/lib/push.ts.
const ROWS: { key: Category; label: string; icon: typeof Calendar; bg: string }[] = [
  { key: 'workouts', label: 'תזכורות ואימונים', icon: Calendar, bg: 'bg-primary-600' },
  { key: 'coach', label: 'הודעות מהמאמן', icon: MessageSquare, bg: 'bg-sky-500' },
  { key: 'achievements', label: 'הישגים וסיכומים', icon: Flame, bg: 'bg-emerald-500' },
  { key: 'program', label: 'תוכנית שבועית', icon: ClipboardList, bg: 'bg-amber-500' },
];

// Per-user notification preferences — each athlete chooses which categories of
// push they receive. Optimistic toggle; saves to /api/athletes/notification-prefs.
// Hidden until we know the athleteId. Degrades gracefully pre-migration (the API
// returns all-on defaults and PUT is a no-op 501, so toggles simply won't stick).
export function NotificationPrefs({ athleteId }: { athleteId: string }) {
  const { data, mutate } = useApi<{ prefs: Prefs }>(
    athleteId ? `/api/athletes/notification-prefs?athleteId=${encodeURIComponent(athleteId)}` : null,
  );
  const [saving, setSaving] = useState<Category | null>(null);
  const prefs = data?.prefs;

  const toggle = async (key: Category) => {
    if (!prefs) return;
    const next = { ...prefs, [key]: !prefs[key] };
    setSaving(key);
    mutate({ prefs: next }, false); // optimistic
    try {
      const res = await fetch('/api/athletes/notification-prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ athleteId, category: key, enabled: next[key] }),
      });
      if (!res.ok) mutate(); // revalidate → roll back on failure/501
    } catch {
      mutate();
    } finally {
      setSaving(null);
    }
  };

  if (!athleteId || !prefs) return null;

  return (
    <div className="rounded-2xl bg-slate-800/80 border border-slate-700/50 overflow-hidden divide-y divide-slate-700/50" dir="rtl">
      <p className="px-4 pt-3 pb-1 text-2xs font-bold uppercase tracking-wider text-slate-500">התראות</p>
      {ROWS.map(({ key, label, icon: Icon, bg }) => {
        const on = prefs[key];
        return (
          <div key={key} className="flex items-center gap-3 px-4 py-3 min-h-[52px]">
            <span className={cn('shrink-0 w-7 h-7 rounded-md flex items-center justify-center', bg)}>
              <Icon className="h-4 w-4 text-white" />
            </span>
            <span className="flex-1 text-[15px] font-medium text-white">{label}</span>
            <button
              onClick={() => toggle(key)}
              disabled={saving === key}
              className={cn('relative w-12 h-7 rounded-full transition-colors shrink-0 disabled:opacity-60', on ? 'bg-green-500' : 'bg-slate-600')}
              aria-label={label}
            >
              <span className={cn('absolute top-1 h-5 w-5 rounded-full bg-white transition-all', on ? 'start-6' : 'start-1')} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
