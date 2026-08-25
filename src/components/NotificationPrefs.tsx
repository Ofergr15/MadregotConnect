'use client';

import { useState, useEffect } from 'react';
import { Calendar, MessageSquare, Flame, ClipboardList, Users, Megaphone, PartyPopper, BellRing } from 'lucide-react';
import { useApi } from '@/lib/api';
import { InsetSection, InsetRow } from '@/components/ui/InsetList';
import { Switch } from '@/components/ui';
import { subscribeToPush } from '@/lib/pwa';

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
    // Disabled specifically here: this is what actually caused the "toggle it
    // off and it turns back on" bug — a revalidateOnFocus refetch racing a
    // slow PUT (e.g. backgrounding right after tapping) could land first and
    // silently overwrite the toggle with the pre-toggle value. This data
    // doesn't change from another device/session in a way that benefits from
    // focus-revalidation, so removing the race source entirely is simpler
    // and safer than trying to out-sequence it.
    { revalidateOnFocus: false },
  );
  const [saving, setSaving] = useState<Category | null>(null);
  const prefs = data?.prefs;

  // Push permission can be revoked (iOS Settings → Notifications → off) or
  // never granted in the first place — PushOptIn only ever offers to
  // subscribe opportunistically (right after workout feedback, or while
  // waiting for approval), so without this there is no way back in for
  // someone whose permission got reset outside those two moments.
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [enabling, setEnabling] = useState(false);
  const [enableError, setEnableError] = useState<string | null>(null);
  useEffect(() => {
    if (typeof Notification === 'undefined') return;
    const refresh = () => setPermission(Notification.permission);
    refresh();
    // The iOS system permission prompt backgrounds this page while it's up —
    // re-check on return instead of trusting enablePush's own post-await read,
    // since that read can land before iOS has actually applied the decision.
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const enablePush = async () => {
    setEnabling(true);
    setEnableError(null);
    try {
      const result = await subscribeToPush(athleteId);
      if (typeof Notification !== 'undefined') setPermission(Notification.permission);
      // Visible on the device itself, not just in a console nobody's looking
      // at — a silent failure here previously meant no way to tell what
      // actually went wrong without production log access.
      if (!result.ok) setEnableError(result.error || 'unknown_error');
    } finally {
      setEnabling(false);
    }
  };

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
      {permission && permission !== 'granted' && (
        <InsetSection header="פוש">
          <InsetRow
            icon={BellRing}
            iconBg="bg-red-500"
            label={enabling ? 'מפעיל...' : 'הפעלת התראות פוש'}
            sublabel={
              enableError ? `שגיאה: ${enableError}`
                : permission === 'denied' ? 'חסום — יש לאשר בהגדרות המכשיר'
                : 'לא הופעלו במכשיר הזה'
            }
            onClick={permission === 'denied' ? undefined : enablePush}
          />
        </InsetSection>
      )}
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
