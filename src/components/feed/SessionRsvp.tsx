'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { useApi, apiHeaders } from '@/lib/api';
import { cn, GROUP_HEX } from '@/lib/utils';
import { packLabel, type Lineup, type LineupFace } from '@/lib/attendance/lineup';

// ═════════════════════════════════════════════════════════════════════════════
// WHO IS COMING, AND ONE TAP TO JOIN — the bottom half of the feed's
// next-session card (feed redesign 2026-10-12, the "start line" that won the
// three-way design round: ~/.cache/madregot/feed-redesign/variants/W.html).
//
// One row per pack, yours first. Before answering, your row holds the one big
// button in the pack's colour ("מגיעים עם דבוקה 1"); the others offer "להצטרף".
// After answering, your face sits in the chosen row with a tick, the row takes the
// pack's frame and the others go grey with "מעבר". It writes the same
// workout_attendance row the reminder push's buttons and the dashboard RSVP
// write, label "דבוקה N" — so it also answers the pack poll (one question).
// ═════════════════════════════════════════════════════════════════════════════

type LineupResponse = Lineup & { homeIndex: number };

function Faces({ faces, extra, ring }: { faces: LineupFace[]; extra: number; ring?: string }) {
  return (
    <span className="flex items-center">
      {faces.slice(0, 3).map((f, i) => (
        f.avatarUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img key={f.id} src={f.avatarUrl} alt="" className={cn('h-6 w-6 rounded-full object-cover border-2 border-card', i && '-ms-2')} style={ring && i === 0 ? { boxShadow: `0 0 0 2px ${ring}` } : undefined} />
          : <span key={f.id} className={cn('flex h-6 w-6 items-center justify-center rounded-full border-2 border-card bg-page text-4xs font-bold text-ink-500', i && '-ms-2')}>{f.name.slice(0, 1)}</span>
      ))}
      {extra > 0 && <span className="-ms-2 flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-card bg-page px-1 text-4xs font-bold text-ink-500"><bdi dir="ltr">+{extra}</bdi></span>}
    </span>
  );
}

export function SessionRsvp({ weekStart, day, paces, whenLabel, onAnswered }: {
  weekStart: string;
  day: number;
  /** Each pack's main pace, already formatted ("5:05–5:15"), or null. */
  paces: Array<string | null>;
  /** "מחר" / "היום", for the question. */
  whenLabel: string;
  onAnswered?: (attending: boolean, index: number) => void;
}) {
  const t = useTranslations('nextSession');
  const key = `/api/attendance/lineup?weekStart=${weekStart}&day=${day}`;
  const { data, mutate } = useApi<LineupResponse>(key);
  const [busy, setBusy] = useState(false);

  if (!data) return <div className="h-[218px]" aria-hidden />; // reserved: the card must not grow under the thumb

  const home = data.homeIndex >= 0 ? data.homeIndex : 0;
  const mine = data.mine;
  const going = mine?.attending ? mine.index : null;
  const order = [home, ...[0, 1, 2].filter((i) => i !== home)];

  const answer = async (attending: boolean, index: number) => {
    const athleteId = localStorage.getItem('athlete_id');
    if (!athleteId || busy) return;
    setBusy(true);
    try { navigator.vibrate?.(10); } catch { /* */ }
    try {
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: await apiHeaders(true),
        body: JSON.stringify({ athleteId, weekStart, day, attending, groupLabel: attending ? packLabel(index) : null }),
      });
      if (res.ok) { await mutate(); onAnswered?.(attending, index); }
    } finally { setBusy(false); }
  };

  return (
    <div className="mt-3 border-t border-page pt-3" dir="rtl">
      <div className="mb-2 flex items-center justify-between">
        <b className="text-sm font-extrabold text-ink-900">{going != null ? t('whoComing', { when: whenLabel }) : t('areYouComing', { when: whenLabel })}</b>
        {data.total > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-ink-400">
            <Faces faces={data.packs.flatMap((p) => p.faces).slice(0, 3)} extra={0} />
            {t('confirmed', { count: data.total })}
          </span>
        )}
      </div>

      <div className="space-y-2">
        {order.map((i) => {
          const p = data.packs[i];
          const hex = GROUP_HEX[i];
          const isHome = i === home;
          const chosen = going === i;
          const other = going != null && !chosen;
          const extra = Math.max(p.count - Math.min(p.faces.length, 3), 0);
          return (
            <div
              key={i}
              className={cn('rounded-2xl transition-colors', chosen ? 'p-2.5' : isHome && going == null ? 'p-2.5' : 'px-2.5 py-2', other ? 'bg-page/70' : 'bg-page')}
              style={chosen ? { background: `${hex}14`, boxShadow: `inset 0 0 0 2px ${hex}` } : isHome && going == null ? { boxShadow: `inset 0 0 0 1px ${hex}55`, background: '#fff' } : undefined}
            >
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black text-white" style={{ background: other ? '#B4B5BC' : hex }}>{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className={cn('block text-sm font-bold', other ? 'text-ink-500' : 'text-ink-900')}>
                    {packLabel(i)}
                    {chosen && <span className="ms-1.5 rounded-pill px-1.5 py-px text-3xs font-extrabold text-white" style={{ background: hex }}>✓ {t('coming')}</span>}
                  </span>
                  {(isHome || chosen) && paces[i] && <span className="block text-2xs text-ink-400">{t('pace')} <bdi dir="ltr">{paces[i]}</bdi></span>}
                </span>
                <Faces faces={p.faces} extra={extra} ring={chosen ? hex : undefined} />
                <span className={cn('w-5 text-center text-sm font-extrabold', other ? 'text-ink-400' : 'text-ink-900')}>{p.count}</span>
                {!(isHome && going == null) && !chosen && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => answer(true, i)}
                    className="h-8 shrink-0 rounded-pill border-[1.5px] bg-card px-3 text-xs font-bold disabled:opacity-50"
                    style={{ borderColor: other ? '#C7C8CF' : hex, color: other ? '#55565F' : hex }}
                  >
                    {going != null ? t('switch') : t('join')}
                  </button>
                )}
              </div>
              {isHome && going == null && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => answer(true, i)}
                  className="mt-2.5 flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl text-base font-extrabold text-white shadow-[0_10px_22px_-10px_rgba(0,0,0,0.45)] active:scale-[0.99] disabled:opacity-60"
                  style={{ background: hex }}
                >
                  <Check className="h-5 w-5" strokeWidth={3} />
                  {t('comingWith')}
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-sm font-black" style={{ color: hex }}>{i + 1}</span>
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex justify-center">
        {mine && !mine.attending ? (
          <span className="text-xs font-bold text-ink-500">{t('notComingSet')}</span>
        ) : (
          <button type="button" disabled={busy} onClick={() => answer(false, home)} className="min-h-[36px] px-3 text-xs font-bold text-ink-400 underline-offset-2 hover:underline">
            {t('notThisTime')}
          </button>
        )}
      </div>
    </div>
  );
}
