'use client';

import { useState } from 'react';
import { GraduationCap } from 'lucide-react';
import { useApi } from '@/lib/api';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { InsetRow } from '@/components/ui/InsetList';
import { Switch } from '@/components/ui';

// "סיור מאמן והנקודות הכחולות" — the club switch for the coach tour (lib/tour/switch.ts),
// next to the maintenance switch. Off by default; admin and super user only (the PUT
// answers 403 to anyone else, and the row hides itself the same way).
export function CoachTourSwitchRow() {
  const { data, mutate } = useApi<{ on: boolean; canToggle: boolean }>('/api/tours/switch');
  const [saving, setSaving] = useState(false);
  if (!data?.canToggle) return null;
  const on = data.on;
  const toggle = async () => {
    setSaving(true);
    mutate({ ...data, on: !on }, false);
    try {
      const res = await fetch('/api/tours/switch', { method: 'PUT', headers: await bearerHeaders(), body: JSON.stringify({ on: !on }) });
      if (res.ok) mutate(await res.json(), false);
      else mutate();
    } catch { mutate(); }
    finally { setSaving(false); }
  };
  return (
    <InsetRow
      icon={GraduationCap}
      iconBg={on ? 'bg-brand-600' : 'bg-ink-300'}
      label="סיור מאמן והנקודות הכחולות"
      sublabel={on ? 'מאמנים מקבלים את הסיור בכניסה הראשונה, והנקודות מופיעות' : 'כבוי לכולם — אתה יכול לנסות מ״עוד ← סיור מאמן״'}
      trailing={<Switch checked={on} onChange={toggle} disabled={saving} loading={saving} activeColor="bg-brand-600" ariaLabel="סיור מאמן" />}
    />
  );
}
