'use client';

import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { useApi } from '@/lib/api';
import { FeedAvatar } from '@/components/FeedAvatar';
import { SkeletonList } from '@/components/ui';
import { FeatureSettings, StateCard, type StoriesHome } from '@/components/stories/StoryAdmin';
import { Group, SectionHead } from '@/components/content/hub-ui';
import { birthdayHref, birthdayReady, dayWord, shortDate } from '@/lib/stories/area';
import type { BirthdayConfig } from '@/lib/birthday-year/server';
import type { StoryState } from '@/lib/stories/gate';
import { cn } from '@/lib/utils';

// יום הולדת — Content › stories v5 (mockup ~/.cache/madregot/stories-area/mockup.html,
// Ofer 10-20). One screen: the state with one button, then people — who still needs
// preparing ("מחכה לך"), this week, and later. Everything about ONE person (where it
// shows, how long, the push, what's inside, the preview) is on their own screen.

interface Up { athleteId: string; name: string | null; avatarUrl: string | null; period: string; bucket: string; status: string; summary: string }
interface Prep { athleteId: string; name: string | null; avatarUrl: string | null; birthday: string; config: BirthdayConfig }

const VARS = { '--c': '#e0306e', '--c2': '#fde8ef', '--ci': '#a01d4c' } as CSSProperties;

/** "היום" / "מחר", else the date ("ש׳ 24.10"). */
const when = (day: string, today: string) => { const w = dayWord(day, today); return w === 'היום' || w === 'מחר' ? w : shortDate(day); };

export default function BirthdaysPage() {
  const { data: st, mutate: reSt } = useApi<StoriesHome>('/api/admin/stories');
  const { data: up, error } = useApi<{ today: string; rows: Up[] }>('/api/admin/stories/upcoming?feature=birthday');
  const { data: prep } = useApi<{ rows: Prep[] }>('/api/admin/birthdays');

  const state = st?.settings?.find((s) => s.feature === 'birthday')?.state ?? 'off';
  const today = up?.today ?? '';
  const cfgOf = (id: string, day: string) => prep?.rows.find((p) => p.athleteId === id && p.birthday === day)?.config;
  const rows = up?.rows ?? [];
  const skipped = (r: Up) => r.status === 'skipped' || r.status === 'disabled' || r.status === 'opted_out';
  // Prep status only exists while the feature is on (the route shows no data while off).
  const known = state !== 'off' && !!prep;
  const waiting = known ? rows.filter((r) => !skipped(r) && !birthdayReady(cfgOf(r.athleteId, r.period))) : [];
  const week = rows.filter((r) => !waiting.includes(r));
  const later = (prep?.rows ?? []).filter((p) => !rows.some((r) => r.athleteId === p.athleteId));

  const row = (r: { athleteId: string; name: string | null; avatarUrl: string | null; period: string }, tail: ReactNode, sub: string) => (
    <Link key={`${r.athleteId}:${r.period}`} href={birthdayHref(r.athleteId, r.period)} className="flex min-h-[60px] items-center gap-3 px-3.5 py-2 active:bg-page">
      <FeedAvatar name={r.name || ''} url={r.avatarUrl} className="h-10 w-10 text-[14px]" />
      <span className="min-w-0 flex-1">
        <b dir="auto" className="block truncate text-[15px] font-semibold text-ink-900">{(r.name || '').split(/\s+/)[0]}</b>
        <small className="block truncate text-12 text-ink-400">{sub}</small>
      </span>
      {tail}
      <ChevronLeft className="h-4 w-4 text-[#c4c4c9]" />
    </Link>
  );

  return (
    <div style={VARS} className="pb-8" dir="rtl">
      <div className="flex h-11 items-center">
        <Link href="/dashboard/content" className="inline-flex min-h-[44px] items-center text-[17px] text-[#007aff]">‹ תוכן</Link>
      </div>
      <div className="flex items-center gap-3 pb-3">
        <span aria-hidden className="grid h-[46px] w-[46px] place-items-center rounded-[12px] text-[24px]" style={{ background: 'var(--c)' }}>🎂</span>
        <h1 className="flex-1 text-[30px] font-extrabold tracking-[-0.4px] text-ink-900">יום הולדת</h1>
      </div>

      {st && <StateCard feature="birthday" home={st} onChanged={() => void reSt()} />}

      {!up && !error && <div className="mt-4"><SkeletonList count={3} /></div>}
      {error && <p className="mt-4 text-sm font-bold text-accent-red-ink">לא הצלחנו לטעון</p>}

      {waiting.length > 0 && (<>
        <SectionHead trailing={<span className="rounded-full px-2 text-[11px] font-extrabold text-white" style={{ background: 'var(--c)' }}>{waiting.length}</span>}>מחכה לך</SectionHead>
        <Group>{waiting.map((r) => row(r, <span className="text-[12.5px] font-extrabold" style={{ color: 'var(--c)' }}>להכין</span>, `${when(r.period, today)} · בלי תמונות ובלי מילה`))}</Group>
      </>)}

      {week.length > 0 && (<>
        <SectionHead gray>השבוע</SectionHead>
        <Group>{week.map((r) => row(r,
          skipped(r) ? <span className="rounded-full bg-page px-2 py-0.5 text-[11px] font-extrabold text-ink-400">דילוג</span>
            : known ? <span className="text-[12.5px] font-extrabold text-[#15803d]">מוכן ✓</span> : null,
          `${when(r.period, today)}${r.summary && r.summary !== 'ברירת מחדל' ? ` · ${r.summary}` : ''}`))}</Group>
      </>)}

      {later.length > 0 && (<>
        <SectionHead gray>בהמשך</SectionHead>
        <Group>{later.map((p) => row({ athleteId: p.athleteId, name: p.name, avatarUrl: p.avatarUrl, period: p.birthday },
          null, shortDate(p.birthday)))}</Group>
      </>)}

      {st && <FeatureSettings feature="birthday" home={st} onChanged={() => void reSt()} />}
    </div>
  );
}
