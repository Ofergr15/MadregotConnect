'use client';

import { useState } from 'react';
import { Sun } from 'lucide-react';
import { useApi } from '@/lib/api';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { InsetRow } from '@/components/ui/InsetList';
import { Switch } from '@/components/ui';

// "אזור המאמן" — the club switch for the coach space (lib/coach-space/switch.ts), beside the
// coach tour's. Off by default; admin and super user only (the PUT answers 403 to anyone else,
// and the row hides itself the same way).
export function CoachSpaceSwitchRow() {
  const { data, mutate } = useApi<{ on: boolean; canToggle: boolean }>('/api/coach-space/switch');
  const [saving, setSaving] = useState(false);
  if (!data?.canToggle) return null;
  const on = data.on;
  const toggle = async () => {
    setSaving(true);
    mutate({ ...data, on: !on }, false);
    try {
      const res = await fetch('/api/coach-space/switch', { method: 'PUT', headers: await bearerHeaders(), body: JSON.stringify({ on: !on }) });
      if (res.ok) mutate(await res.json(), false);
      else mutate();
    } catch { mutate(); }
    finally { setSaving(false); }
  };
  return (
    <InsetRow
      icon={Sun}
      iconBg={on ? 'bg-brand-600' : 'bg-ink-300'}
      label="אזור המאמן (היום · השבוע · רצים · תובנות)"
      sublabel={on ? 'למאמנים יש את ארבע הלשוניות בסרגל התחתון' : 'כבוי — מאמנים רואים את הסרגל של היום. תצוגה מקדימה: ‎/dashboard/coach/today'}
      trailing={<Switch checked={on} onChange={toggle} disabled={saving} loading={saving} activeColor="bg-brand-600" ariaLabel="אזור המאמן" />}
    />
  );
}
