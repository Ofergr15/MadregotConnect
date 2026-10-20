'use client';

import { useState } from 'react';
import { CalendarDays, Cake, Flag, Megaphone } from 'lucide-react';
import { apiHeaders, useApi } from '@/lib/api';
import { InsetSection, InsetRow } from '@/components/ui/InsetList';
import { Switch } from '@/components/ui';
import type { StoryPrefKey, StoryPrefs } from '@/lib/stories/prefs';

/**
 * The athlete's own story opt-outs (athletes.story_prefs, migration 157). Off here = no
 * story, no push and no public birthday post for them, whatever the admin turns on.
 * Hidden until 157 is pasted (the API answers ready:false).
 */
const ROWS: Array<{ key: StoryPrefKey; label: string; sub: string; icon: typeof Cake; bg: string }> = [
  { key: 'weekly', label: 'הסיכום השבועי', sub: 'בשבת בערב, השבוע שלך בריצה', icon: CalendarDays, bg: 'bg-brand-600' },
  { key: 'birthday', label: 'סיפור יום ההולדת', sub: 'השנה שלך בריצה, ביום ההולדת', icon: Cake, bg: 'bg-accent-600' },
  { key: 'birthday_feed_post', label: 'פוסט יום הולדת בפיד המועדון', sub: 'כולם יראו שהיום יום ההולדת שלך (בלי גיל ובלי נתונים)', icon: Megaphone, bg: 'bg-accent-600' },
  { key: 'annual', label: 'הסיכום השנתי', sub: 'ב־31.12 בערב, השנה שלך בריצה', icon: Flag, bg: 'bg-brand-600' },
];

export function StoryPrefsSection() {
  const { data, mutate } = useApi<{ ready: boolean; prefs: StoryPrefs }>('/api/me/story-prefs');
  const [saving, setSaving] = useState<StoryPrefKey | null>(null);
  const [err, setErr] = useState(false);
  if (!data?.ready) return null;
  const toggle = async (key: StoryPrefKey, enabled: boolean) => {
    setSaving(key); setErr(false);
    try {
      const res = await fetch('/api/me/story-prefs', { method: 'PUT', headers: await apiHeaders(true), body: JSON.stringify({ key, enabled }) });
      if (!res.ok) throw new Error();
      await mutate(await res.json(), { revalidate: false });
    } catch {
      setErr(true);
    } finally {
      setSaving(null);
    }
  };
  return (
    <InsetSection header="סיפורים">
      {ROWS.map(({ key, label, sub, icon, bg }) => {
        const on = data.prefs[key] !== false;
        return (
          <InsetRow key={key} icon={icon} iconBg={bg} label={label} sublabel={sub} sublabelClamp
            trailing={<Switch checked={on} onChange={(v) => void toggle(key, v)} disabled={saving === key} activeColor="bg-accent-600" ariaLabel={label} />} />
        );
      })}
      {err && <p className="px-4 pb-2 text-xs text-accent-red">השמירה נכשלה, נסו שוב</p>}
    </InsetSection>
  );
}
