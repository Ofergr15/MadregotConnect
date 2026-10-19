'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight, MoreHorizontal } from 'lucide-react';
import { useApi } from '@/lib/api';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { addDaysToDateStr, cn } from '@/lib/utils';
import { Sheet } from '@/components/ui';

// "חגיגות" (mockup celebrations-control, 3-4): what is on the circles at the top of the
// feed and until when, the automatic birthdays included, and ⋯ to extend or end one.
// Ending takes it off the circles only; the feed post stays.

interface Row {
  id: string; source: 'feed' | 'club'; emoji: string; label: string; title: string;
  day: string; until: string; active: boolean; likes: number; auto: boolean;
}

const CARD = 'rounded-[18px] bg-card';
const LABEL = 'px-1.5 text-13 font-bold text-ink-400';
const WEEKDAY = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

function untilText(until: string, today: string): string {
  if (until === today) return 'עד היום, 23:59';
  if (until === addDaysToDateStr(today, 1)) return 'עד מחר, 23:59';
  const d = new Date(`${until}T12:00:00`);
  return `עד יום ${WEEKDAY[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}`;
}
const endedText = (until: string) => { const d = new Date(`${until}T12:00:00`); return `הסתיים ${d.getDate()}.${d.getMonth() + 1}`; };

export default function CelebrationsPage() {
  const { data, mutate } = useApi<{ today: string; items: Row[]; birthdayDays: number }>('/api/admin/celebrations');
  const [menu, setMenu] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState('');
  const today = data?.today ?? '';
  // Only what is on the circles; surveys and scheduled messages are shown on the hub.
  const items = (data?.items ?? []).filter((r) => r.source === 'feed' || r.source === 'club');
  const active = items.filter((r) => r.active);
  const ended = items.filter((r) => !r.active && r.until < today).slice(0, 12);

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await fetch('/api/admin/celebrations', { method: 'PATCH', headers: await bearerHeaders(), body: JSON.stringify(body) });
      await mutate();
    } finally { setBusy(false); setMenu(null); setPick(''); }
  };
  // Extending counts from today, or from its own last day if that is later.
  const extend = (r: Row, days: number) => patch({ id: r.id, source: r.source, until: addDaysToDateStr(r.until > today ? r.until : today, days) });

  const row = (r: Row) => (
    <div key={`${r.source}:${r.id}`} className={cn(CARD, 'flex items-center gap-3 px-3.5 py-3', !r.active && 'opacity-60')}>
      <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-page text-xl">{r.emoji}</span>
      <span className="min-w-0 flex-1">
        <b className="block truncate text-[14.5px] text-ink-900">{r.title}</b>
        <small className="block text-12 text-ink-500">{r.label}{r.auto ? ' · אוטומטי' : ''}{r.likes ? ` · ${r.likes} לייקים` : ''}</small>
        <span className={cn('mt-1.5 inline-block rounded-full px-2 py-0.5 text-12 font-extrabold', r.active ? 'bg-[#E3F6EA] text-[#12A150]' : 'bg-page text-ink-500')}>
          {r.active ? untilText(r.until, today) : endedText(r.until)}
        </span>
      </span>
      <button type="button" aria-label="עד מתי" onClick={() => setMenu(r)} className="grid h-11 w-11 shrink-0 place-items-center text-ink-400">
        <MoreHorizontal className="h-5 w-5" />
      </button>
    </div>
  );

  return (
    <div className="space-y-3 pb-28" dir="rtl">
      <Link href="/dashboard/content" className="inline-flex min-h-[44px] items-center gap-0.5 text-[15px] font-semibold text-brand-600"><ChevronRight className="h-4 w-4" />תוכן</Link>
      <div>
        <h1 className="text-[26px] font-black text-ink-700">חגיגות</h1>
        <p className="text-13 text-ink-400">מה בעיגולים בראש הפיד, ועד מתי</p>
      </div>

      <p className={LABEL}>עכשיו בעיגולים</p>
      {!data && <p className="px-2 text-sm text-ink-400">…</p>}
      {data && active.length === 0 && <p className={cn(CARD, 'px-4 py-4 text-sm text-ink-400')}>אין עכשיו חגיגות בעיגולים</p>}
      <div className="space-y-2">{active.map(row)}</div>

      {ended.length > 0 && (<><p className={LABEL}>הסתיימו</p><div className="space-y-2">{ended.map(row)}</div></>)}

      {data && (
        <div className={cn(CARD, 'px-4 py-3')}>
          <b className="block text-[14.5px] text-ink-900">ימי הולדת אוטומטיים נשארים</b>
          <div className="mt-2 flex rounded-[11px] bg-[#E3E3E9] p-[2px]" role="tablist">
            {([[1, 'יום'], [2, 'יומיים'], [3, '3 ימים'], [7, 'שבוע']] as const).map(([d, l]) => (
              <button key={d} type="button" role="tab" aria-selected={data.birthdayDays === d} disabled={busy}
                onClick={() => patch({ birthdayDays: d })}
                className={cn('min-h-[36px] flex-1 rounded-[9px] text-13 font-bold', data.birthdayDays === d ? 'bg-card text-ink-900 shadow-sm' : 'text-ink-500')}>{l}</button>
            ))}
          </div>
          <small className="mt-1.5 block text-12 text-ink-400">ליום ההולדת הבא. מה שכבר בעיגולים: עם ⋯</small>
        </div>
      )}

      <Sheet open={!!menu} onOpenChange={(o) => { if (!o) { setMenu(null); setPick(''); } }}>
        {menu && (
          <div className="pb-4" dir="rtl">
            <p className="px-4 pb-2 pt-1 text-center text-13 font-bold text-ink-400">עד מתי בעיגולים?</p>
            {([['עד מחר', 1], ['עוד 3 ימים', 3], ['עוד שבוע', 7]] as const).map(([l, d]) => (
              <button key={l} type="button" disabled={busy} onClick={() => (l === 'עד מחר' ? patch({ id: menu.id, source: menu.source, until: addDaysToDateStr(today, 1) }) : extend(menu, d))}
                className="block min-h-[52px] w-full border-b border-page text-center text-base font-semibold text-brand-600">{l}</button>
            ))}
            <div className="flex items-center gap-2 border-b border-page px-4 py-2">
              <input type="date" value={pick} min={today} onChange={(e) => setPick(e.target.value)} dir="ltr" className="min-h-[44px] flex-1 rounded-xl bg-page px-3 text-base" />
              <button type="button" disabled={!pick || busy} onClick={() => patch({ id: menu.id, source: menu.source, until: pick })} className="min-h-[44px] rounded-xl bg-brand-600 px-4 text-sm font-bold text-white disabled:opacity-40">לתאריך הזה</button>
            </div>
            {menu.active && (
              <button type="button" disabled={busy} onClick={() => patch({ id: menu.id, source: menu.source, end: true })}
                className="block min-h-[52px] w-full text-center text-base font-semibold text-[#E5383B]">להוריד מהעיגולים עכשיו</button>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
