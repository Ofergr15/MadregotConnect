'use client';

// תובנות (mockup "יאיר · אימונים" › תובנות): the charts, drawn with the club-numbers chart kit
// (components/club-numbers/charts). Weekly km by pack and runners per week come from
// /api/coach/volume; group-practice confirmations from /api/attendance?calendar=1.

import { addDaysToDateStr, israelToday } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { Columns, CountColumns, Legend, WeekLines } from '@/components/club-numbers/charts';
import { HE_DAY_NAMES, packSeries, shortDay } from '@/lib/coach-space/model';
import { B, Card, CardHead, Loading, ScreenHeader, usePeople, useVolume } from './shared';

const PACK_COLORS = { A: '#C2410C', B: '#1525FF', C: '#0B6E4F' };
const PRACTICES_SHOWN = 12;

export function CoachInsights() {
  const people = usePeople();
  const volume = useVolume(10);
  const today = people.data?.today ?? israelToday();
  const from = addDaysToDateStr(today, -70);
  const cal = useApi<{ days: Record<string, { going: number; notGoing: number; total: number }> }>(`/api/attendance?calendar=1&from=${from}&to=${today}`);

  if (!volume.data) return <><ScreenHeader title="תובנות" /><Loading /></>;

  const weeks = volume.data.weeks;
  const rows = volume.data.athletes;
  const series = packSeries(rows, weeks.length);
  const total = Math.round(rows.reduce((s, r) => s + r.series.reduce((a, b) => a + b, 0), 0));
  const active = weeks.map((_, i) => rows.filter((r) => (r.series[i] ?? 0) > 0).length);
  const practices = Object.entries(cal.data?.days ?? {}).sort(([a], [b]) => a.localeCompare(b)).slice(-PRACTICES_SHOWN);
  const avgGoing = practices.length ? Math.round(practices.reduce((s, [, d]) => s + d.going, 0) / practices.length) : 0;

  return (
    <>
      <ScreenHeader title="תובנות" />

      <Card>
        <CardHead title="ק״מ לפי דבוקה" side={<><B>{total.toLocaleString('en-US')}</B> ק״מ ב־<B>{weeks.length}</B> שבועות</>} />
        <WeekLines weeks={weeks} series={(['A', 'B', 'C'] as const).map((k) => ({ label: k, color: PACK_COLORS[k], values: series[k] }))} height={170} />
        <Legend items={[{ label: 'דבוקה A', color: PACK_COLORS.A }, { label: 'דבוקה B', color: PACK_COLORS.B }, { label: 'דבוקה C', color: PACK_COLORS.C }]} />
      </Card>

      <Card>
        <CardHead title="כמה רצו בכל שבוע" side={<>מתוך <B>{rows.length}</B></>} />
        <CountColumns weeks={weeks} values={active} color="#1525FF" track="#EEF0FF" lead={10} />
        <p className="mt-2 text-[12px] text-ink-400">רץ שרץ לפחות פעם אחת בשבוע. השבוע עוד לא נגמר.</p>
      </Card>

      <Card>
        <CardHead title="אישורי הגעה באימונים קבוצתיים" side={practices.length ? <>ממוצע <B>{avgGoing}</B></> : undefined} />
        {!cal.data ? <div className="h-28 animate-pulse rounded-[14px] bg-page" />
          : practices.length === 0 ? <p className="text-[14px] text-ink-400">אין אישורי הגעה בעשרת השבועות האחרונים</p>
            : (
              <>
                <Columns values={practices.map(([, d]) => d.going)} labels={practices.map(([d]) => shortDay(d))} height={130} showValues={practices.map((_, i) => i)} />
                <p className="mt-2 text-[12px] text-ink-400">
                  {[...new Set(practices.map(([d]) => HE_DAY_NAMES[new Date(`${d}T12:00:00`).getDay()]))].join(' · ')} · מי שלחץ ״מגיע״ בכל אימון
                </p>
              </>
            )}
      </Card>
    </>
  );
}
