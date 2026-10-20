'use client';

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { useApi } from '@/lib/api';
import { FEATURE_META, FEATURE_ORDER, STATE_TAG, weekSections, type UpcomingLike, type WeekSection } from '@/lib/stories/area';
import type { StoryFeature, StoryState } from '@/lib/stories/gate';
import type { LiveRow } from '@/components/content/use-hub';
import { cn } from '@/lib/utils';

// The top of Content (mockup stories-area v5, Ofer 10-20): what is on air now, scheduled
// this week and in testing — every kind together, one section each, an empty one absent —
// and the stories block (birthday, weekly, annual) with each one's state. A coach who is
// not a story admin gets 403 from the stories routes and simply sees the live part.

const SECTION: Record<WeekSection, { label: string; color: string; tag: string; tone: string }> = {
  air: { label: 'באוויר עכשיו', color: '#15803d', tag: 'באוויר', tone: 'bg-[#DCFCE7] text-[#15803d]' },
  scheduled: { label: 'מתוזמן השבוע', color: '#1f6feb', tag: 'מתוזמן', tone: 'bg-[#E0EBFF] text-[#1f6feb]' },
  testing: { label: 'בבדיקה', color: '#B45309', tag: 'בדיקה', tone: 'bg-[#FEF3C7] text-[#B45309]' },
};
const TONE = { off: 'bg-page text-ink-400', test: 'bg-[#FEF3C7] text-[#B45309]', on: 'bg-[#DCFCE7] text-[#15803d]' };

export function StoriesHome({ live, today }: { live: LiveRow[]; today: string }) {
  const { data: st } = useApi<{ settings: Array<{ feature: StoryFeature; state: StoryState; generate_at?: string }> }>('/api/admin/stories');
  const { data: up } = useApi<{ rows: UpcomingLike[] }>('/api/admin/stories/upcoming?feature=birthday');
  const features = st?.settings ?? [];
  const secs = weekSections(live, up?.rows ?? [], features, today);
  const birthdays = (up?.rows ?? []).filter((r) => r.status === 'ready').length;

  return (
    <>
      {(Object.keys(SECTION) as WeekSection[]).map((k) => secs[k].length > 0 && (
        <section key={k}>
          <div className="flex items-center gap-[7px] px-1 pb-[7px] pt-2 text-13 font-extrabold" style={{ color: SECTION[k].color }}>
            <span className="h-[7px] w-[7px] rounded-full" style={{ background: SECTION[k].color }} />
            {SECTION[k].label}
            <span className="rounded-full px-[7px] text-[11px] text-white" style={{ background: SECTION[k].color }}>{secs[k].length}</span>
          </div>
          <div className="overflow-hidden rounded-[18px] bg-card">
            {secs[k].map((r, i) => (
              <Link key={r.key} href={r.href} className={cn('flex min-h-[54px] items-center gap-2.5 px-3.5 py-2 active:bg-page', i > 0 && 'border-t-[0.5px] border-black/[0.08]')}>
                {r.logo
                  // The Madregot circle: its logo, as on the feed's row.
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src="/images/logo.png" alt="" className="h-7 w-7 rounded-full bg-white object-contain ring-2 ring-[#FF0069]" />
                  : <span aria-hidden className="w-7 text-center text-[18px]">{r.emoji}</span>}
                <span className="min-w-0 flex-1">
                  <b dir="auto" className="block truncate text-[15px] font-semibold text-ink-900">{r.title}</b>
                  <small className="block truncate text-12 text-ink-400">{r.sub}</small>
                </span>
                <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-extrabold', SECTION[k].tone)}>{SECTION[k].tag}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}

      {features.length > 0 && (
        <section className="overflow-hidden rounded-[18px] bg-card">
          <div className="flex min-h-[56px] items-center gap-[11px] px-3.5 pb-2.5 pt-3">
            <span aria-hidden className="grid h-[34px] w-[34px] place-items-center rounded-[9px] bg-[#7638FA] text-[17px]">✨</span>
            <b className="flex-1 text-[17px] font-bold tracking-[-0.2px] text-ink-900">סיפורים</b>
          </div>
          {FEATURE_ORDER.map((f) => {
            const s = features.find((x) => x.feature === f);
            if (!s) return null;
            const tag = STATE_TAG[s.state];
            const sub = f === 'birthday' ? (birthdays ? `${birthdays} השבוע` : 'אין השבוע') : f === 'weekly' ? `שבת ${(s.generate_at || '18:00').slice(0, 5)}` : '31.12';
            return (
              <Link key={f} href={FEATURE_META[f].href} className="flex min-h-[52px] items-center gap-2.5 border-t-[0.5px] border-black/[0.08] px-3.5 py-2 active:bg-page">
                <span aria-hidden className="w-6 text-center text-[18px]">{FEATURE_META[f].emoji}</span>
                <span className="min-w-0 flex-1">
                  <b className="block text-[15px] font-semibold text-ink-900">{FEATURE_META[f].title}</b>
                  <small className="block text-12 text-ink-400">{sub}</small>
                </span>
                <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-extrabold', TONE[tag.tone])}>{tag.label}</span>
                <ChevronLeft className="h-4 w-4 text-[#c4c4c9]" />
              </Link>
            );
          })}
        </section>
      )}
    </>
  );
}
