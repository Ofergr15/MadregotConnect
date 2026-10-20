'use client';

import { cn } from '@/lib/utils';
import { formatDuration, formatPace } from './format';
import type { RepTarget } from '@/lib/activities/rep-target';

// The run page's "עוד מדדים" and "החזרות מול היעד" (mockup run-page-b): a card per metric
// with a big number, a small picture of where it sits, and a line saying what it means;
// and the reps as bars against the target pace of the runner's own pack.

function Scale({ value, lo, hi, marks, color }: { value: number; lo: number; hi: number; marks: number[]; color: string }) {
  const pos = Math.max(0, Math.min(1, (value - lo) / (hi - lo))) * 100;
  return (
    <div className="mt-2.5" dir="ltr">
      <div className="relative h-2 rounded-full" style={{ background: `linear-gradient(90deg,#E9ECF5,${color})` }}>
        <i className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-ink-900 bg-white" style={{ left: `${pos}%` }} />
      </div>
      <div className="relative h-3.5 text-[9.5px] text-ink-400">
        {marks.map((m) => <span key={m} className="absolute top-0.5 -translate-x-1/2" style={{ left: `${((m - lo) / (hi - lo)) * 100}%` }}>{m}</span>)}
      </div>
    </div>
  );
}

function Card({ icon, tint, title, sub, value, unit, wide, children, note }: {
  icon: string; tint: string; title: string; sub?: string; value: string; unit?: string; wide?: boolean; children?: React.ReactNode; note?: React.ReactNode;
}) {
  return (
    <div className={cn('rounded-2xl bg-page px-3 py-3', wide && 'col-span-2')}>
      <div className="flex items-center gap-2">
        <span aria-hidden className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[10px] text-base" style={{ background: tint }}>{icon}</span>
        <span className="min-w-0 flex-1">
          <b className="block text-[13.5px] font-extrabold text-ink-900">{title}</b>
          {sub && <small className="block text-[11px] text-ink-400">{sub}</small>}
        </span>
        {wide && <bdi dir="ltr" className="text-[26px] font-extrabold tabular-nums text-ink-900">{value}</bdi>}
      </div>
      {!wide && (
        <p className="mt-2 text-[26px] font-extrabold leading-none tracking-tight text-ink-900">
          <bdi dir="ltr" className="tabular-nums">{value}</bdi>{unit && <small className="ms-1 text-sm font-bold text-ink-400">{unit}</small>}
        </p>
      )}
      {children}
      {note && <p className="mt-1.5 text-xs leading-snug text-ink-500">{note}</p>}
    </div>
  );
}

export interface MetricValues {
  vo2: number | null;
  rpe: number | null;
  avgHr: number | null;
  maxHr: number | null;
  /** The athlete's ceiling the zones use. */
  hrCeiling: number;
  cadence: number | null;
  stride: number | null;
  moving: number | null;
  total: number;
  elevation: number | null;
  calories: number | null;
  distanceKm: number;
}

export function MetricCards({ m }: { m: MetricValues }) {
  const rpe = m.rpe != null ? Math.round(m.rpe) : null;
  return (
    <div className="grid grid-cols-2 gap-2">
      {m.vo2 != null && (
        <Card wide icon="🫁" tint="#EEF0FF" title="VO₂max" sub="מגרמין, מהריצות האחרונות" value={String(m.vo2)}>
          <Scale value={m.vo2} lo={35} hi={70} marks={[40, 50, 60, 70]} color="#1525FF" />
        </Card>
      )}
      {rpe != null && (
        <Card icon="😌" tint="#E3F6EA" title="מאמץ" sub="כמו שדירגת" value={`${rpe}`} unit="/10"
          note={rpe <= 3 ? 'קל' : rpe <= 6 ? 'בינוני' : 'קשה'}>
          <div className="mt-2 flex gap-[3px]" dir="ltr">
            {Array.from({ length: 10 }, (_, k) => (
              <i key={k} className="h-2 flex-1 rounded-sm" style={{ background: k < rpe ? (k < 4 ? '#4CC67A' : k < 7 ? '#F5B83D' : '#E5383B') : '#E3E3EA' }} />
            ))}
          </div>
        </Card>
      )}
      {m.avgHr != null && (
        <Card icon="❤️" tint="#FDEBEB" title="דופק" sub="ממוצע" value={String(Math.round(m.avgHr))}
          note={<>מקס׳ <bdi dir="ltr">{m.maxHr ?? '—'}</bdi> · <bdi dir="ltr">{Math.round((m.avgHr / m.hrCeiling) * 100)}%</bdi> מהמקסימלי</>}>
          <div className="relative mt-2.5 h-2 rounded-full bg-[#E3E3EA]" dir="ltr">
            <i className="block h-full rounded-full bg-[#E5383B]" style={{ width: `${(m.avgHr / m.hrCeiling) * 100}%` }} />
            {m.maxHr != null && <em className="absolute -top-[3px] h-3.5 w-[3px] rounded-sm bg-ink-900" style={{ left: `${(m.maxHr / m.hrCeiling) * 100}%` }} />}
          </div>
        </Card>
      )}
      {m.cadence != null && (
        <Card icon="👣" tint="#F3EEFF" title="קדנס" sub="צעדים לדקה" value={String(Math.round(m.cadence))}>
          <Scale value={m.cadence} lo={150} hi={195} marks={[160, 170, 180]} color="#7C3AED" />
        </Card>
      )}
      {m.stride != null && (
        <Card icon="📏" tint="#FFF4DB" title="אורך צעד" sub="ממוצע" value={m.stride.toFixed(2)} unit="מ׳">
          <Scale value={m.stride} lo={0.8} hi={1.6} marks={[1.0, 1.2, 1.4]} color="#C27803" />
        </Card>
      )}
      {m.moving != null && (
        <Card icon="⏱" tint="#EEF6FF" title="זמן בתנועה" sub="מתוך הכל" value={formatDuration(m.moving)}
          note={m.total > m.moving ? <>עצירות: <bdi dir="ltr">{formatDuration(m.total - m.moving)}</bdi></> : 'בלי עצירות'}>
          <div className="mt-2.5 h-2 rounded-full bg-[#E3E3EA]" dir="ltr"><i className="block h-full rounded-full bg-[#1580F0]" style={{ width: `${(m.moving / (m.total || m.moving)) * 100}%` }} /></div>
        </Card>
      )}
      {m.elevation != null && (
        <Card icon="⛰️" tint="#F2F2F7" title="טיפוס" sub="כל העליות" value={String(Math.round(m.elevation))} unit="מ׳"
          note={m.elevation / Math.max(m.distanceKm, 1) < 8 ? 'מסלול כמעט שטוח' : 'מסלול עם עליות'} />
      )}
      {m.calories != null && (
        <Card wide icon="🔥" tint="#FFEDE3" title="קלוריות" sub="הערכה של גרמין" value={Number(m.calories).toLocaleString('en')}
          note={<>כ־<bdi dir="ltr">{Math.round(m.calories / Math.max(m.distanceKm, 0.1))}</bdi> קלוריות לכל ק״מ</>} />
      )}
    </div>
  );
}

const W = 340, PADL = 34, PADR = 6;

/** The reps (laps of `target.meters`) against the runner's target pace, faster = taller. */
export function RepsVsTarget({ laps, target }: { laps: Array<{ distance: number; duration: number }>; target: RepTarget }) {
  const reps = laps.filter((l) => Math.abs(l.distance - target.meters) <= Math.max(15, target.meters * 0.08) && l.duration > 0);
  if (reps.length < 2) return null;
  const paces = reps.map((l) => l.duration / (l.distance / 1000));
  const lo = Math.min(target.min, ...paces) - 10, hi = Math.max(target.max, ...paces) + 10;
  const H = 150, base = H - 20, CW = W - PADL - PADR;
  const y = (p: number) => 10 + ((p - lo) / (hi - lo)) * (base - 10);
  const bw = CW / reps.length;
  const okLimit = target.pace + 2;
  const onTarget = paces.filter((p) => p <= okLimit).length;
  const avg = paces.reduce((a, b) => a + b, 0) / paces.length;
  const ticks = [0, 1, 2, 3].map((k) => lo + 10 + (k * (hi - lo - 20)) / 3);
  return (
    <div>
      <p className="text-xs font-bold text-ink-400">
        ממוצע <bdi dir="ltr">{formatPace(avg)}</bdi> · <bdi dir="ltr">{onTarget}/{reps.length}</bdi> ביעד
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="mt-2 block" style={{ direction: 'ltr' }} aria-label="החזרות מול היעד">
        {ticks.map((tv) => (
          <g key={tv}>
            <line x1={PADL} x2={W - PADR} y1={y(tv)} y2={y(tv)} stroke="#EEEEF3" />
            <text x={PADL - 5} y={y(tv) + 3} fontSize={9} textAnchor="end" fill="#8A8B96">{formatPace(tv)}</text>
          </g>
        ))}
        <rect x={PADL} y={y(target.min)} width={CW} height={Math.max(1, y(target.max) - y(target.min))} fill="rgba(21,37,255,.06)" />
        <line x1={PADL} x2={W - PADR} y1={y(target.pace)} y2={y(target.pace)} stroke="#1525FF" strokeWidth={1.4} strokeDasharray="5 3" />
        <rect x={0} y={y(target.pace) - 8} width={PADL - 3} height={15} rx={4} fill="#1525FF" />
        <text x={(PADL - 3) / 2} y={y(target.pace) + 3} fontSize={9} textAnchor="middle" fill="#fff" fontWeight={800}>{formatPace(target.pace)}</text>
        {paces.map((p, i) => {
          const x0 = PADL + i * bw + 3, top = y(p), cx = x0 + (bw - 6) / 2;
          return (
            <g key={i}>
              <rect x={x0} y={top} width={bw - 6} height={Math.max(2, base - top)} rx={3} fill={p <= okLimit ? '#12A150' : '#F5B83D'} />
              {base - top > 30 && bw > 14 && (
                <text transform={`translate(${cx + 3.2},${base - 5}) rotate(-90)`} fontSize={9.5} fill="#fff" fontWeight={800}>{formatPace(p)}</text>
              )}
              <text x={cx} y={H - 7} fontSize={9} textAnchor="middle" fill="#8A8B96">{i + 1}</text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] font-bold text-ink-500">
        <span><i className="me-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#12A150] align-[-1px]" />ביעד או מהר</span>
        <span><i className="me-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#F5B83D] align-[-1px]" />איטי מהיעד</span>
        <span><i className="me-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#1525FF]/15 align-[-1px]" />טווח הדבוקות <bdi dir="ltr">{formatPace(target.min)}–{formatPace(target.max)}</bdi></span>
      </div>
    </div>
  );
}
