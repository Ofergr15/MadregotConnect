'use client';

import { useEffect, type CSSProperties } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Eye } from 'lucide-react';
import { useApi } from '@/lib/api';
import { SkeletonList } from '@/components/ui';
import { FeatureSettings, ReceiversList, StateCard, TestersCard, type StoriesHome, type UpRow } from '@/components/stories/StoryAdmin';
import { FEATURE_META } from '@/lib/stories/area';
import type { StoryFeature } from '@/lib/stories/gate';

// סיכום שבועי / סיכום שנתי — the same screen as יום הולדת (Content › stories v5, Ofer
// 10-20): the state with one button, what applies to everyone, the testers, who gets it.

const BG: Record<string, string> = { weekly: '#1f6feb', annual: '#7638FA' };

export default function StoryFeaturePage() {
  const router = useRouter();
  const { feature } = useParams<{ feature: string }>();
  const f = (feature === 'weekly' || feature === 'annual' ? feature : null) as StoryFeature | null;
  useEffect(() => { if (feature === 'birthday') router.replace('/dashboard/birthdays'); }, [feature, router]);
  const { data: home, mutate } = useApi<StoriesHome>('/api/admin/stories');
  const state = home?.settings.find((s) => s.feature === f)?.state ?? 'off';
  const { data: up, mutate: reUp } = useApi<{ rows: UpRow[]; nextAt: string | null }>(f && state !== 'off' ? `/api/admin/stories/upcoming?feature=${f}` : null);
  if (!f) return null;
  const changed = () => { void mutate(); void reUp(); };
  const preview = f === 'weekly' ? '/feed?weekStory=1' : '/feed?annualStory=1';
  return (
    <div style={{ '--c': BG[f] } as CSSProperties} className="pb-8" dir="rtl">
      <div className="flex h-11 items-center justify-between">
        <Link href="/dashboard/content" className="inline-flex min-h-[44px] items-center text-[17px] text-[#007aff]">‹ תוכן</Link>
        {state !== 'off' && <Link href={preview} className="inline-flex min-h-[44px] items-center gap-1 text-[15px] font-bold text-ink-900"><Eye className="h-4 w-4" />תצוגה</Link>}
      </div>
      <div className="flex items-center gap-3 pb-3">
        <span aria-hidden className="grid h-[46px] w-[46px] place-items-center rounded-[12px] text-[24px]" style={{ background: BG[f] }}>{FEATURE_META[f].emoji}</span>
        <h1 className="flex-1 text-[30px] font-extrabold tracking-[-0.4px] text-ink-900">{FEATURE_META[f].title}</h1>
      </div>
      {!home ? <SkeletonList count={3} /> : (
        <>
          <StateCard feature={f} home={home} onChanged={changed} />
          <FeatureSettings feature={f} home={home} onChanged={changed} />
          <TestersCard home={home} onChanged={changed} />
          {up && <ReceiversList rows={up.rows} href={(r) => `/dashboard/stories/${f}/${r.athleteId}?period=${r.period}`} />}
        </>
      )}
    </div>
  );
}
