'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Users, Loader2 } from 'lucide-react';
import { getPlanWeekStart } from '@/lib/utils';

interface Row { athleteId: string; attending: boolean; groupLabel: string | null; name: string; avatarUrl: string | null; }

// Coach view: who has RSVP'd for TODAY's workout, grouped by דבוקה.
export function AttendanceRoster() {
  const t = useTranslations('attendance');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const weekStart = getPlanWeekStart(new Date());
    const day = new Date().getDay();
    fetch(`/api/attendance?weekStart=${weekStart}&day=${day}&roster=1`)
      .then(r => r.ok ? r.json() : null)
      .then(data => setRows(data?.attendance || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const going = rows.filter(r => r.attending);
  const notGoing = rows.filter(r => !r.attending);

  // Bucket the attending athletes by their chosen דבוקה.
  const byGroup: Record<string, Row[]> = {};
  for (const r of going) {
    const g = r.groupLabel || '—';
    (byGroup[g] ||= []).push(r);
  }

  return (
    <div className="rounded-2xl bg-slate-800/60 border border-slate-700/50 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Users className="h-4 w-4 text-[#4338ff]" />
        <h3 className="text-sm font-bold text-white" dir="rtl">{t('title')}</h3>
        {!loading && (
          <span className="ms-auto text-xs font-bold text-green-400 tabular-nums">
            {going.length} {t('goingCount')}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 text-slate-500 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-slate-500 py-2 text-center" dir="rtl">{t('noRsvp')}</p>
      ) : (
        <div className="space-y-3">
          {Object.entries(byGroup).map(([group, members]) => (
            <div key={group}>
              <p className="text-[11px] font-bold text-slate-400 mb-1.5" dir="rtl">{group} · {members.length}</p>
              <div className="flex flex-wrap gap-1.5">
                {members.map(m => (
                  <span key={m.athleteId} className="inline-flex items-center gap-1.5 bg-slate-900/50 rounded-full ps-1 pe-2.5 py-1">
                    {m.avatarUrl
                      ? <img src={m.avatarUrl} alt="" className="w-5 h-5 rounded-full object-cover" referrerPolicy="no-referrer" />
                      : <span className="w-5 h-5 rounded-full bg-[#4338ff]/30 flex items-center justify-center text-[9px] font-bold text-white">{(m.name[0] || '?').toUpperCase()}</span>}
                    <span className="text-xs text-slate-200" dir="auto">{m.name.split(' ')[0]}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
          {notGoing.length > 0 && (
            <p className="text-[11px] text-slate-500 pt-1" dir="rtl">
              {notGoing.length} {t('notComing')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
