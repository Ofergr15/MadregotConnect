'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { useApi } from '@/lib/api';
import { SkeletonList, Switch } from '@/components/ui';
import { Group } from '@/components/content/hub-ui';
import { putStories, type StoriesHome } from '@/components/stories/StoryAdmin';
import { FEATURE_META, FEATURE_ORDER, STATE_TAG } from '@/lib/stories/area';
import { cn } from '@/lib/utils';

// "סיפורים" — the three stories and "השהה הכל". Each story has its own screen now
// (Content › stories v5, Ofer 10-20): /dashboard/birthdays, /dashboard/stories/weekly,
// /dashboard/stories/annual — the state, what applies to everyone, testers, who gets it.

const TONE = { off: 'bg-page text-ink-400', test: 'bg-[#FEF3C7] text-[#B45309]', on: 'bg-[#DCFCE7] text-[#15803d]' };

export default function StoriesAdminPage() {
  const { data, error, mutate } = useApi<StoriesHome>('/api/admin/stories');
  const [busy, setBusy] = useState(false);
  const pause = async (on: boolean) => {
    setBusy(true);
    try { await putStories({ paused: on }); await mutate(); } finally { setBusy(false); }
  };
  return (
    <div className="pb-8" dir="rtl">
      <div className="flex h-11 items-center">
        <Link href="/dashboard/content" className="inline-flex min-h-[44px] items-center text-[17px] text-[#007aff]">‹ תוכן</Link>
      </div>
      <h1 className="pb-3 text-[30px] font-extrabold tracking-[-0.4px] text-ink-900">סיפורים</h1>
      {!data && !error && <SkeletonList count={3} />}
      {error && <p className="text-sm font-bold text-accent-red-ink">לא הצלחנו לטעון</p>}
      {data && (
        <>
          <Group>
            {FEATURE_ORDER.map((f) => {
              const s = data.settings.find((x) => x.feature === f);
              if (!s) return null;
              const tag = STATE_TAG[s.state];
              return (
                <Link key={f} href={FEATURE_META[f].href} className="flex min-h-[60px] items-center gap-3 px-3.5 py-2 active:bg-page">
                  <span aria-hidden className="w-7 text-center text-[22px]">{FEATURE_META[f].emoji}</span>
                  <b className="min-w-0 flex-1 text-[16px] font-semibold text-ink-900">{FEATURE_META[f].title}</b>
                  <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-extrabold', TONE[tag.tone])}>{tag.label}</span>
                  <ChevronLeft className="h-4 w-4 text-[#c4c4c9]" />
                </Link>
              );
            })}
          </Group>
          <div className={cn('mt-4 flex min-h-[64px] items-center gap-3 rounded-[16px] border-[1.5px] bg-card px-4 py-2.5', data.paused ? 'border-accent-red' : 'border-transparent')}>
            <span className="min-w-0 flex-1">
              <b className="block text-[16px] text-ink-900">⏸ השהה הכל</b>
              <small className="block text-13 text-ink-400">עוצר מיד כל התראה וכל סיפור</small>
            </span>
            <Switch checked={data.paused} onChange={(v) => void pause(v)} loading={busy} activeColor="bg-accent-red" ariaLabel="השהה הכל" />
          </div>
        </>
      )}
    </div>
  );
}
