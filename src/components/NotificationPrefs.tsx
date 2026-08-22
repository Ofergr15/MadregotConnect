'use client';

import { useState } from 'react';
import { Calendar, MessageSquare, Flame, ClipboardList, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { InsetSection, InsetRow } from '@/components/ui/InsetList';

type Category = 'workouts' | 'coach' | 'achievements' | 'program' | 'teammates';
type Prefs = Record<Category, boolean>;

// The toggleable categories, with a colored glyph + Hebrew label, matching the
// push categories in src/lib/push.ts.
const ROWS: { key: Category; label: string; icon: typeof Calendar; bg: string }[] = [
  { key: 'workouts', label: 'תזכורות ואימונים', icon: Calendar, bg: 'bg-primary-600' },
  { key: 'coach', label: 'הודעות מהמאמן', icon: MessageSquare, bg: 'bg-sky-500' },
  { key: 'achievements', label: 'הישגים וסיכומים', icon: Flame, bg: 'bg-emerald-500' },
  { key: 'program', label: 'תוכנית שבועית', icon: ClipboardList, bg: 'bg-amber-500' },
  { key: 'teammates', label: 'אימוני חברי הקבוצה', icon: Users, bg: 'bg-orange-500' },
];

// One canonical toggle-switch look (48×28), duplicated locally here and in
// MaintenanceToggle/ReminderConfig — there's no shared `Switch` primitive in
// the design system yet, so each of those three Settings components carried
// its own slightly-different hand-rolled track/thumb. Keeping this local copy
// (rather than adding one to ui/index.tsx) still fixes the visual mismatch
// between the three since they now all render this exact size/style.
function Switch({ on, onToggle, disabled, label }: { on: boolean; onToggle: () => void; disabled?: boolean; label?: string }) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      aria-label={label}
      className={cn('relative w-12 h-7 rounded-full transition-colors shrink-0 disabled:opacity-60', on ? 'bg-green-500' : 'bg-slate-600')}
    >
      <span className={cn('absolute top-1 h-5 w-5 rounded-full bg-white transition-all', on ? 'start-6' : 'start-1')} />
    </button>
  );
}

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
    <div dir="rtl">
      <InsetSection header="התראות">
        {ROWS.map(({ key, label, icon, bg }) => {
          const on = prefs[key];
          return (
            <InsetRow
              key={key}
              icon={icon}
              iconBg={bg}
              label={label}
              trailing={<Switch on={on} onToggle={() => toggle(key)} disabled={saving === key} label={label} />}
            />
          );
        })}
      </InsetSection>
    </div>
  );
}
