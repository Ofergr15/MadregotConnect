'use client';

import { useState } from 'react';
import { Calendar, MessageSquare, Flame, ClipboardList, Users, Megaphone, PartyPopper } from 'lucide-react';
import { useApi } from '@/lib/api';
import { InsetSection, InsetRow } from '@/components/ui/InsetList';
import { Switch } from '@/components/ui';

type Category = 'workouts' | 'coach' | 'achievements' | 'program' | 'teammates' | 'news' | 'events';
type Prefs = Record<Category, boolean>;

// The toggleable categories, with a colored glyph + Hebrew label, matching the
// push categories in src/lib/push.ts.
const ROWS: { key: Category; label: string; icon: typeof Calendar; bg: string }[] = [
  { key: 'workouts', label: 'תזכורות ואימונים', icon: Calendar, bg: 'bg-primary-600' },
  { key: 'coach', label: 'הודעות מהמאמן', icon: MessageSquare, bg: 'bg-sky-500' },
  { key: 'achievements', label: 'הישגים וסיכומים', icon: Flame, bg: 'bg-emerald-500' },
  { key: 'program', label: 'תוכנית שבועית', icon: ClipboardList, bg: 'bg-amber-500' },
  { key: 'teammates', label: 'אימוני חברי הקבוצה', icon: Users, bg: 'bg-orange-500' },
  { key: 'news', label: 'עדכונים והודעות כלליות', icon: Megaphone, bg: 'bg-rose-500' },
  { key: 'events', label: 'תזכורות לאירועים ותחרויות', icon: PartyPopper, bg: 'bg-violet-500' },
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
              trailing={<Switch checked={on} onChange={() => toggle(key)} disabled={saving === key} activeColor="bg-green-500" ariaLabel={label} />}
            />
          );
        })}
      </InsetSection>
    </div>
  );
}
