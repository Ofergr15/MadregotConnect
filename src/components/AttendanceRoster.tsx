'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Users, Loader2 } from 'lucide-react';
import { getPlanWeekStart } from '@/lib/utils';
import { apiHeaders } from '@/lib/api';

interface Row { athleteId: string; attending: boolean; groupLabel: string | null; name: string; avatarUrl: string | null; }

// Coach view: who has RSVP'd for a specific workout (today's, or the next team
// day when previewing the day before), grouped by דבוקה. Defaults to today.
export function AttendanceRoster({ weekStart: weekStartProp, day: dayProp }: { weekStart?: string; day?: number } = {}) {
  const t = useTranslations('attendance');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const weekStart = weekStartProp ?? getPlanWeekStart(new Date());
  const day = dayProp ?? new Date().getDay();

  const refetch = useCallback(() => {
    return apiHeaders()
      .then(h => fetch(`/api/attendance?weekStart=${weekStart}&day=${day}&roster=1`, { headers: h }))
      .then(r => r.ok ? r.json() : null)
      .then(data => setRows(data?.attendance || []))
      .catch(() => {});
  }, [weekStart, day]);

  useEffect(() => {
    refetch().finally(() => setLoading(false));
  }, [refetch]);

  // A runner's ✅/❌ tap on a background push notification can land here while
  // a coach already has this roster open — the SW can't reach into this
  // component directly, so it posts a message instead; refetch on a match
  // instead of showing a stale roster until a manual reload.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.source === 'madregot-sw' && msg.type === 'rsvp' && msg.ok && msg.weekStart === weekStart && String(msg.day) === String(day)) {
        refetch();
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [weekStart, day, refetch]);

  const going = rows.filter(r => r.attending);
  const notGoing = rows.filter(r => !r.attending);

  // Bucket the attending athletes by their chosen דבוקה.
  const byGroup: Record<string, Row[]> = {};
  for (const r of going) {
    const g = r.groupLabel || '—';
    (byGroup[g] ||= []).push(r);
  }

  return (
    <div className="rounded-card bg-card/60 border border-page/50 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Users className="h-4 w-4 text-brand-600" />
        <h3 className="text-sm font-bold text-ink-700" dir="rtl">{t('title')}</h3>
        {!loading && (
          <span className="ms-auto text-xs font-bold text-accent-600 tabular-nums">
            {going.length} {t('goingCount')}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 text-ink-400 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-ink-400 py-2 text-center" dir="rtl">{t('noRsvp')}</p>
      ) : (
        <div className="space-y-3">
          {Object.entries(byGroup).map(([group, members]) => (
            <div key={group}>
              <p className="text-2xs font-bold text-ink-400 mb-1.5" dir="rtl">{group} · {members.length}</p>
              <div className="flex flex-wrap gap-1.5">
                {members.map(m => (
                  <span key={m.athleteId} className="inline-flex items-center gap-1.5 bg-page/50 rounded-full ps-1 pe-2.5 py-1">
                    {m.avatarUrl
                      ? <img src={m.avatarUrl} alt="" className="w-5 h-5 rounded-full object-cover" referrerPolicy="no-referrer" />
                      : <span className="w-5 h-5 rounded-full bg-brand-600/30 flex items-center justify-center text-3xs font-bold text-white">{(m.name[0] || '?').toUpperCase()}</span>}
                    <span className="text-xs text-ink-700" dir="auto">{m.name.split(' ')[0]}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
          {notGoing.length > 0 && (
            <p className="text-2xs text-ink-400 pt-1" dir="rtl">
              {notGoing.length} {t('notComing')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
