'use client';

import { fmtKm } from '@/lib/academy/pace-verdict';

// Moved here unchanged from AcademyMyView (2026-10-11), so the month board can show it in
// place of the weekly ⚡ bars while a trainee's load is still being learned
// (trainee-experience-v2 screen 3: never an empty chart).

// ── The km chart ────────────────────────────────────────────────────────────
// Time runs left to right whatever the page direction: it is an SVG, and a
// timeline that ran right-to-left would put "this week" under the trainee's
// thumb's opposite edge from every other chart in the app. One hue: the brand
// blue for this week, its light tint for the weeks before, a dashed outline for
// what is planned this week, and a dashed line for the average.

const MONTHS = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];

export function KmCard({ weeks, plannedKm, avgKm, doneKm, isCurrentWeek, completed, planned }: {
  weeks: Array<{ weekStart: string; km: number }>;
  plannedKm: number;
  avgKm: number | null;
  doneKm: number;
  isCurrentWeek: boolean;
  completed: number;
  planned: number;
}) {
  const W = 330, base = 54, y0 = 6, r = 4;
  const n = Math.max(weeks.length, 1);
  const slot = W / n;
  const bw = Math.max(4, slot - 7);
  const max = Math.max(...weeks.map((w) => w.km), plannedKm, avgKm ?? 0, 1) * 1.08;
  const h = (v: number) => ((base - y0) * v) / max;
  const bar = (x: number, height: number) => (height <= r
    ? `M${x},${base} v${-height} h${bw} v${height} z`
    : `M${x},${base} v${-(height - r)} q0,-${r} ${r},-${r} h${bw - 2 * r} q${r},0 ${r},${r} v${height - r} z`);

  // Three ticks: the first month, the first month change in the middle, and the end.
  const ticks: Array<[number, string]> = [];
  if (weeks.length) {
    const month = (i: number) => new Date(`${weeks[i].weekStart}T12:00:00Z`).getUTCMonth();
    ticks.push([0, MONTHS[month(0)]]);
    for (let i = 3; i < weeks.length - 3; i++) {
      if (month(i) !== month(i - 1)) { ticks.push([i, MONTHS[month(i)]]); break; }
    }
    ticks.push([weeks.length - 1, isCurrentWeek ? 'השבוע' : 'שבוע זה']);
  }

  return (
    <div className="rounded-2xl bg-card px-3 pb-1.5 pt-2">
      <div className="flex items-baseline justify-between gap-2">
        <b className="text-[15px] font-black text-ink-700">
          {isCurrentWeek ? 'השבוע' : 'בשבוע'} <bdi dir="ltr">{fmtKm(doneKm * 1000)}</bdi>{' '}
          <span className="text-xs font-semibold text-ink-400">מתוך <bdi dir="ltr">{fmtKm(plannedKm * 1000)}</bdi> ק״מ</span>
        </b>
        <span className="shrink-0 text-xs font-bold text-ink-400">{completed} מתוך {planned} אימונים</span>
      </div>
      <svg viewBox={`0 0 ${W} 64`} className="mt-1 block h-16 w-full overflow-visible" role="img"
        aria-label={`ק״מ ב־${weeks.length} השבועות האחרונים`}>
        {[0, 0.5, 1].map((g) => (
          <line key={g} x1={0} x2={W} y1={base - (base - y0) * g} y2={base - (base - y0) * g} stroke="#EEEEF2" />
        ))}
        {weeks.map((w, i) => {
          const x = i * slot + (slot - bw) / 2;
          const last = i === weeks.length - 1;
          return (
            <g key={w.weekStart}>
              {last && plannedKm > 0 && (
                <path d={bar(x, h(plannedKm))} fill="#F4F5FF" stroke="#1525FF" strokeWidth={1.5} strokeDasharray="3 2" />
              )}
              {w.km > 0 && <path d={bar(x, h(w.km))} fill={last ? '#1525FF' : '#9FA8FF'} />}
            </g>
          );
        })}
        {avgKm != null && avgKm > 0 && (
          <line x1={0} x2={W} y1={base - h(avgKm)} y2={base - h(avgKm)} stroke="#2D2E38" strokeDasharray="2 3" opacity={0.45} />
        )}
        {ticks.map(([i, label]) => (
          <text key={i} x={i * slot + slot / 2} y={64} textAnchor="middle" fontSize={10} fill="#5F5F5F">{label}</text>
        ))}
      </svg>
      <div className="mt-0.5 flex gap-2.5 text-3xs text-ink-400">
        <span className="inline-flex items-center gap-1"><i className="inline-block h-[9px] w-[9px] rounded-[3px] bg-brand-600" />נרץ</span>
        <span className="inline-flex items-center gap-1"><svg viewBox="0 0 10 10" className="h-[9px] w-[9px]" aria-hidden><rect x="0.75" y="0.75" width="8.5" height="8.5" rx="2.5" fill="none" stroke="#1525FF" strokeWidth="1.5" strokeDasharray="2.5 1.5" /></svg>מתוכנן {isCurrentWeek ? 'השבוע' : ''}</span>
        {avgKm != null && <span className="ms-auto font-bold">ממוצע {weeks.length} שבועות: <bdi dir="ltr">{Math.round(avgKm)}</bdi></span>}
      </div>
    </div>
  );
}
