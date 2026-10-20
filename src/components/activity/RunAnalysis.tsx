'use client';

/**
 * The run page's reading of the workout and the charts under the main stack (mockup
 * ~/.cache/madregot/run-page-v4.html, Ofer 2026-10-20), fed by /api/activities/analysis
 * (lib/run-analysis/workout) and the trace. Two rules from the review:
 *  - everything is a chart, on real axes, and heart rate is drawn as Garmin and Strava draw
 *    it (a zone-coloured line, numbers in tables — never a line across bars);
 *  - we celebrate: no rep is greyed out or painted as a failure; on-target gets a ✓.
 * Charts run left→right like every chart in the app; the text around them stays RTL.
 */
import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/api';
import type { Seg, Workout } from '@/lib/run-analysis/workout';
import type { StreamKmSplit, StreamView } from '@/lib/activities/stream-view';
import { HR_ZONE_FLOORS } from '@/lib/activities/stream-view';
import { cn } from '@/lib/utils';
import { formatPace } from './format';

export interface RunAnalysisData {
  workout: Workout | null;
  linked: { id: string; start: string; km: number; after: boolean } | null;
  similar: Array<{ id: string; date: string; title: string; avgPace: number }>;
  efforts: Array<{ key: string; meters: number; seconds: number; start: number; rep: number | null }>;
  prs: Record<string, { seconds: number; date: string } | null>;
  recovery: Array<{ rep: number; from: number; to: number }>;
  technique: Array<{ rep: number; cadence: number; stride: number }>;
  conditions: { tempC: number; dewC: number; humidity: number; feelsC: number | null; costSec: number } | null;
  trainingEffect: { aerobic?: number; anaerobic?: number; label?: string | null; load?: number | null; recoveryHours?: number | null } | null;
  hrVisible: boolean;
}

export function useRunAnalysis(activityId: string | null) {
  return useApi<RunAnalysisData>(activityId && /^[0-9a-f-]{36}$/i.test(activityId) ? `/api/activities/analysis?activityId=${activityId}` : null);
}

const B = ({ children }: { children: React.ReactNode }) => <bdi dir="ltr">{children}</bdi>;
const GREEN = '#15803d'; const BLUE = '#1525FF'; const TEAL = '#0F766E';
const ZONE_COLOR = ['#9CA3AF', '#3B82F6', '#22C55E', '#F59E0B', '#EF4444'];
const zoneOf = (hr: number, maxHr: number) => { let z = 0; HR_ZONE_FLOORS.forEach((f, k) => { if (hr >= maxHr * f) z = k; }); return z; };
const clock = (s: number) => { const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const x = Math.round(s % 60); return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
const dm = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}`;

function Card({ title, sub, children }: { title: string; sub?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-card bg-card p-3.5">
      <div className="mb-1.5 flex items-baseline justify-between gap-2"><h3 className="text-sm font-extrabold text-ink-900">{title}</h3>{sub && <span className="text-[11.5px] text-ink-400">{sub}</span>}</div>
      {children}
    </section>
  );
}
const Insight = ({ children }: { children: React.ReactNode }) => <div className="mt-2.5 rounded-[14px] bg-[#EEF0FF] px-3 py-2.5 text-[12.5px] leading-relaxed text-[#1D2A99]">{children}</div>;
function Legend({ items }: { items: Array<{ label: string; color?: string; line?: boolean }> }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-500">
      {items.map((i) => <span key={i.label} className="flex items-center gap-1.5">{i.color && <i className={cn('block', i.line ? 'h-[2px] w-3' : 'h-[9px] w-[9px] rounded-[3px]')} style={{ background: i.color }} />}{i.label}</span>)}
    </div>
  );
}

/** Columns per rep on a pace axis (faster = taller), the pack's target as a black tick. */
function RepColumns({ reps, height = 180, showHr = true }: { reps: Seg[]; height?: number; showHr?: boolean }) {
  const W = 330; const PT = 22; const PB = showHr ? 30 : 18; const PR = 34; const ih = height - PT - PB; const iw = W - PR - 4;
  const paces = reps.flatMap((r) => [r.pace ?? 0, r.target ?? r.pace ?? 0]).filter(Boolean);
  const lo = Math.floor((Math.min(...paces) - 6) / 10) * 10; const hi = Math.ceil((Math.max(...paces) + 8) / 10) * 10;
  const y = (p: number) => PT + ((Math.min(Math.max(p, lo), hi) - lo) / (hi - lo)) * ih;
  const slot = iw / reps.length; const bw = slot * 0.6;
  const ticks: number[] = []; for (let v = lo; v <= hi; v += (hi - lo) > 40 ? 20 : 10) ticks.push(v);
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="block w-full" style={{ height, direction: 'ltr' }} role="img">
      {ticks.map((v) => <g key={v}><line x1={4} x2={4 + iw} y1={y(v)} y2={y(v)} stroke="#F0F1F4" /><text x={W - 2} y={y(v) + 3.5} textAnchor="end" className="fill-ink-400 text-[10px]">{formatPace(v)}</text></g>)}
      {reps.map((r, i) => {
        const x = 4 + i * slot + (slot - bw) / 2; const p = r.pace ?? hi;
        return (
          <g key={i}>
            <rect x={x} y={y(p)} width={bw} height={PT + ih - y(p)} rx={4} fill={GREEN} fillOpacity={0.88} />
            {r.target != null && <line x1={x - 3} x2={x + bw + 3} y1={y(r.target)} y2={y(r.target)} stroke="#16171F" strokeWidth={2} />}
            <text x={x + bw / 2} y={y(p) - 5} textAnchor="middle" className="text-[10px] font-black" fill={GREEN}>{formatPace(p)}</text>
            <text x={x + bw / 2} y={PT + ih + 12} textAnchor="middle" className="fill-ink-400 text-[10px]">{i + 1}{r.onTarget ? ' ✓' : ''}</text>
            {showHr && r.hr != null && <text x={x + bw / 2} y={PT + ih + 25} textAnchor="middle" className="text-[9px] font-bold" fill="#C2410C">{r.hr}</text>}
          </g>
        );
      })}
    </svg>
  );
}

// ── plan against execution ─────────────────────────────────────────────────────────

export function WorkoutCard({ a }: { a: RunAnalysisData }) {
  const t = useTranslations('runAnalysis');
  const w = a.workout; if (!w) return null;
  const total = w.segments.reduce((s, x) => s + x.seconds, 0) || 1;
  const segColor = (s: Seg) => (s.kind === 'rep' ? BLUE : s.kind === 'stride' ? '#8EA0FF' : s.kind === 'recovery' ? '#E3E6F2' : '#9AA3C7');
  const warm = w.segments.filter((s) => s.kind === 'warmup').reduce((s, x) => s + x.meters, 0);
  const same = w.reps.filter((r) => r.target != null && r.target === w.reps[w.reps.length - 1].target);
  const spread = same.length > 1 ? Math.max(...same.map((r) => r.pace ?? 0)) - Math.min(...same.map((r) => r.pace ?? 0)) : null;
  const te = a.trainingEffect;
  const sim = [...a.similar, { id: 'now', date: 'today', title: w.title, avgPace: w.avgPace }];
  return (
    <section className="rounded-card bg-card p-3.5">
      <div className="flex items-center gap-2"><span className="rounded-full bg-[#EEF0FF] px-2.5 py-[3px] text-[11.5px] font-extrabold text-brand-600">{t('intervals')}</span><span className="text-xs text-ink-400">{t('planVsExecution')}</span></div>
      <h3 className="mt-1.5 text-[28px] font-black tracking-tight text-ink-900"><B>{w.title}</B>{w.recoveryMeters && <span className="ms-1.5 text-[15px] font-bold text-ink-400">· {t('jog', { m: w.recoveryMeters })}</span>}</h3>
      <div className="mt-2.5 flex border-t border-[#F0F1F4] pt-2.5">
        {[
          [<span key="a" className="text-[#15803d]"><B>{`${w.hit}/${w.reps.length}`}</B></span>, t('onTarget', { s: w.tolerance })],
          [<B key="b">{formatPace(w.avgPace)}</B>, w.avgTarget ? t('avgRepTarget', { p: formatPace(w.avgTarget) }) : t('avgRep')],
          [<B key="c">{w.avgHr ?? '—'}</B>, t('repsHr')],
        ].map(([v, l], i) => (
          <div key={i} className={cn('flex flex-1 flex-col', i > 0 && 'border-s border-[#F0F1F4] ps-2.5')}><b className="text-[22px] font-black">{v}</b><span className="text-[11px] leading-tight text-ink-400">{l as string}</span></div>
        ))}
      </div>
      <div className="mt-3.5 flex h-4 gap-[1.5px] overflow-hidden rounded-md" dir="ltr">{w.segments.map((s, i) => <i key={i} className="block" style={{ flex: s.seconds / total, background: segColor(s) }} />)}</div>
      <Legend items={[{ label: t('warmup', { km: (warm / 1000).toFixed(1) }), color: '#9AA3C7' }, ...(w.strides.length ? [{ label: t('strides'), color: '#8EA0FF' }] : []), { label: w.title, color: BLUE }, { label: t('recovery'), color: '#E3E6F2' }]} />

      {te && (te.aerobic != null || te.anaerobic != null) && (
        <div className="mt-3 flex gap-2">
          {([['aerobic', te.aerobic, GREEN], ['anaerobic', te.anaerobic, '#6D28D9']] as const).map(([k, v, c]) => v != null && (
            <div key={k} className="flex-1 rounded-[14px] bg-[#F4F5F8] p-2.5">
              <span className="text-[11.5px] font-extrabold text-ink-400">{t(k)}</span>
              <b className="block text-2xl font-black"><B>{v.toFixed(1)}</B></b>
              <div className="my-1 h-[7px] overflow-hidden rounded-full bg-[#E3E5EC]"><i className="block h-full rounded-full" style={{ width: `${Math.min(100, (v / 5) * 100)}%`, background: c }} /></div>
            </div>
          ))}
        </div>
      )}
      {te && (te.aerobic != null || te.anaerobic != null) && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-400">{t('teScale')}{te.load ? ` ${t(te.load >= 300 ? 'loadVeryHigh' : te.load >= 150 ? 'loadHigh' : te.load >= 75 ? 'loadMid' : 'loadLow', { n: Math.round(te.load) })}` : ''}</p>
      )}
      {te?.label && <p className="mt-2 text-[13px]">{t('mainBenefit')}: <b>{t.has(`te_${te.label}`) ? t(`te_${te.label}` as 'te_VO2MAX') : te.label}</b>{te.load ? <span className="text-ink-400"> · {t('load')} <B>{Math.round(te.load)}</B></span> : null}{te.recoveryHours ? <span className="text-ink-400"> · {t('recoveryHours', { h: te.recoveryHours })}</span> : null}</p>}

      <div className="mt-4 text-xs font-extrabold text-ink-400">{t('repsVsTarget')}</div>
      <RepColumns reps={w.reps} />
      <Legend items={[{ label: t('theRep'), color: GREEN }, { label: t('target'), color: '#16171F', line: true }, { label: `✓ ${t('onTargetShort')}` }, { label: `♥ ${t('hr')}` }]} />
      {spread != null && <Insight>{spread <= 2 ? t('steadyNote', { s: spread }) : t('repsNote', { n: w.hit, of: w.reps.length })}</Insight>}

      {a.linked && (
        <div className="mt-3 rounded-[14px] bg-[#E8F6EE] px-3 py-2.5 text-[12.5px] leading-relaxed text-[#0B5A2B]">
          {a.linked.after ? t('linkedCool', { time: a.linked.start, km: a.linked.km }) : t('linkedWarm', { time: a.linked.start, km: a.linked.km })}{' '}
          <Link href={`/dashboard/activities/${a.linked.id}`} className="font-extrabold underline">{t('openIt')}</Link>
        </div>
      )}

      {a.similar.length > 0 && (
        <>
          <div className="mt-4 text-xs font-extrabold text-ink-400">{t('similar')}</div>
          <SimilarTrend items={sim} />
          {sim.length > 1 && sim[0].avgPace > w.avgPace && <Insight>{t('similarNote', { s: sim[0].avgPace - w.avgPace, d: dm(sim[0].date) })}</Insight>}
        </>
      )}
    </section>
  );
}

function SimilarTrend({ items }: { items: Array<{ date: string; title: string; avgPace: number }> }) {
  const t = useTranslations('runAnalysis');
  const W = 330; const H = 140; const PT = 24; const PB = 34; const ih = H - PT - PB;
  const ps = items.map((i) => i.avgPace); const lo = Math.min(...ps) - 5; const hi = Math.max(...ps) + 5;
  const y = (v: number) => PT + ((v - lo) / (hi - lo || 1)) * ih; const x = (i: number) => 40 + (i * (W - 80)) / Math.max(1, items.length - 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" style={{ height: H, direction: 'ltr' }} role="img">
      <polyline points={items.map((it, i) => `${x(i)},${y(it.avgPace)}`).join(' ')} fill="none" stroke={GREEN} strokeWidth={2.6} />
      {items.map((it, i) => {
        const now = i === items.length - 1;
        return (
          <g key={i}>
            <circle cx={x(i)} cy={y(it.avgPace)} r={now ? 6 : 4.5} fill={now ? GREEN : '#fff'} stroke={GREEN} strokeWidth={2.4} />
            <text x={x(i)} y={y(it.avgPace) - 11} textAnchor="middle" className="text-[10px] font-black" fill={GREEN}>{formatPace(it.avgPace)}</text>
            <text x={x(i)} y={H - 18} textAnchor="middle" className="fill-ink-900 text-[10px] font-extrabold">{it.title}</text>
            <text x={x(i)} y={H - 5} textAnchor="middle" className="fill-ink-400 text-[10px]">{it.date === 'today' ? t('today') : dm(it.date)}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ── the charts under the main stack ────────────────────────────────────────────────

/** Over this many km the list opens folded on the first few (Ofer 2026-10-20). */
const SPLITS_FOLD = 10;
const SPLITS_PEEK = 5;

export function KmSplitsList({ splits, maxHr }: { splits: StreamKmSplit[]; maxHr: number }) {
  const t = useTranslations('runAnalysis');
  const [open, setOpen] = useState(false);
  if (splits.length < 2) return null;
  const folded = splits.length > SPLITS_FOLD && !open;
  const full = splits.filter((s) => s.distance >= 900);
  const ps = full.map((s) => s.pace); const lo = Math.min(...ps); const hi = Math.max(...ps);
  return (
    <Card title={t('splits')}>
      <div className="grid grid-cols-[22px_1fr_38px_34px] gap-2 pb-1.5 text-[10.5px] font-extrabold text-ink-400"><span className="text-center">{t('km')}</span><span>{t('pace')}</span><span className="text-center">{t('elev')}</span><span className="text-center">♥</span></div>
      {(folded ? splits.slice(0, SPLITS_PEEK) : splits).map((s) => {
        const fast = s.pace <= lo + (hi - lo) * 0.35;
        const w = hi > lo ? 30 + (1 - (s.pace - lo) / (hi - lo)) * 70 : 100;
        const el = Math.round(s.elevationGain - s.elevationLoss);
        return (
          <div key={s.km} className="grid grid-cols-[22px_1fr_38px_34px] items-center gap-2 py-[3px] text-xs">
            <span className="text-center font-extrabold text-ink-400">{s.km}</span>
            <span className="relative flex h-[18px] items-center"><i className="absolute inset-y-[2px] start-0 block rounded" style={{ width: `${w}%`, background: fast ? BLUE : '#AEB8FF' }} /><b className={cn('relative ps-1.5 text-[11.5px] font-black', fast ? 'text-white' : 'text-ink-900')}><B>{formatPace(s.pace)}</B></b></span>
            <span className="text-center text-[11px] text-ink-400"><B>{el > 0 ? `+${el}` : el}</B></span>
            <span className="text-center font-extrabold" style={{ color: s.hr ? ZONE_COLOR[zoneOf(s.hr, maxHr)] : undefined }}><B>{s.hr ?? '—'}</B></span>
          </div>
        );
      })}
      {splits.length > SPLITS_FOLD && (
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
          className="mt-1.5 flex min-h-[40px] w-full items-center justify-center gap-1 rounded-xl bg-[#F4F5F8] text-[12.5px] font-bold text-ink-700">
          {open ? t('splitsLess') : t('splitsAll', { n: splits.length })}
          <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
        </button>
      )}
    </Card>
  );
}

export function ZoneBars({ seconds, maxHr }: { seconds: number[]; maxHr: number }) {
  const t = useTranslations('runAnalysis');
  const tot = seconds.reduce((s, v) => s + v, 0); if (!tot) return null;
  const mx = Math.max(...seconds);
  const hard = Math.round(((seconds[3] + seconds[4]) / tot) * 100);
  return (
    <Card title={t('zones')} sub={t('ofMinutes', { m: Math.round(tot / 60) })}>
      <div className="flex flex-col gap-[7px]">
        {seconds.map((s, z) => (
          <div key={z} className="flex items-center gap-2">
            <span className="w-[86px] flex-none text-[11.5px] font-bold text-ink-500">{t(`z${z + 1}`)}</span>
            <div className="h-4 flex-1 overflow-hidden rounded-[5px] bg-[#F4F5F8]"><i className="block h-full rounded-[5px]" style={{ width: `${(s / mx) * 100}%`, background: ZONE_COLOR[z] }} /></div>
            <b className="w-[34px] text-end text-[12.5px] font-black"><B>{`${Math.round(s / 60)}′`}</B></b>
          </div>
        ))}
      </div>
      <Insight><b><B>{hard}%</B></b> {t('hardShare', { max: maxHr })}</Insight>
    </Card>
  );
}

export function RepsDetail({ w, maxHr }: { w: Workout; maxHr: number }) {
  const t = useTranslations('runAnalysis');
  const rows: Array<[string, Array<number | null>, (v: number) => string, (v: number) => string | undefined]> = [
    [t('avgHrShort'), w.reps.map((r) => r.hr), String, (v) => ZONE_COLOR[zoneOf(v, maxHr)]],
    [t('maxHrShort'), w.reps.map((r) => r.maxHr), String, (v) => ZONE_COLOR[zoneOf(v, maxHr)]],
    [t('gap'), w.reps.map((r) => r.gap), formatPace, () => undefined],
  ];
  return (
    <Card title={t('reps')} sub={t('repsSub')}>
      <RepColumns reps={w.reps} height={160} showHr={false} />
      {rows.filter(([, vals]) => vals.some((v) => v != null)).map(([label, vals, fmt, color]) => (
        // Aligned under the columns: the chart's plot runs from 4/330 to 296/330 of the width.
        <div key={label} className="relative mt-1 flex items-center" dir="ltr" style={{ paddingLeft: `${(4 / 330) * 100}%`, paddingRight: `${(34 / 330) * 100}%` }}>
          {vals.map((v, i) => <span key={i} className="flex-1 text-center text-[10.5px] font-extrabold" style={{ color: v != null ? color(v) : undefined }}>{v != null ? fmt(v) : '—'}</span>)}
          <em className="absolute right-0 w-[10%] text-end text-[9.5px] not-italic text-ink-400">{label}</em>
        </div>
      ))}
      {w.reps.some((r) => r.gap != null) && <p className="mt-2 text-[11px] leading-relaxed text-ink-400">{t('gapNote')}</p>}
    </Card>
  );
}

export function RecoveryChart({ items }: { items: RunAnalysisData['recovery'] }) {
  const t = useTranslations('runAnalysis');
  if (items.length < 2) return null;
  const W = 330; const H = 170; const PT = 16; const PB = 20; const ih = H - PT - PB; const iw = W - 38;
  const lo = Math.floor((Math.min(...items.map((x) => x.to)) - 8) / 10) * 10; const hi = Math.ceil((Math.max(...items.map((x) => x.from)) + 8) / 10) * 10;
  const y = (v: number) => PT + ((hi - v) / (hi - lo)) * ih; const slot = iw / items.length; const bw = slot * 0.5;
  const ticks: number[] = []; for (let v = lo; v <= hi; v += 20) ticks.push(v);
  const lowest = Math.min(...items.map((x) => x.to)); const highest = Math.max(...items.map((x) => x.to));
  return (
    <Card title={t('recoveryTitle')} sub={t('recoverySub')}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" style={{ height: H, direction: 'ltr' }} role="img">
        <defs><linearGradient id="rec-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#F97316" /><stop offset="1" stopColor="#22C55E" /></linearGradient></defs>
        {ticks.map((v) => <g key={v}><line x1={4} x2={4 + iw} y1={y(v)} y2={y(v)} stroke="#EEF0F4" /><text x={W - 2} y={y(v) + 3.5} textAnchor="end" className="fill-ink-400 text-[10px]">{v}</text></g>)}
        {items.map((r, i) => {
          const x = 4 + i * slot + (slot - bw) / 2;
          return (
            <g key={r.rep}>
              <rect x={x} y={y(r.from)} width={bw} height={Math.max(2, y(r.to) - y(r.from))} rx={5} fill="url(#rec-g)" />
              <text x={x + bw / 2} y={y(r.from) - 4} textAnchor="middle" className="text-[10px] font-black" fill="#C2410C">{r.from}</text>
              <text x={x + bw / 2} y={y(r.to) + 11} textAnchor="middle" className="text-[10px] font-black" fill={GREEN}>{r.to}</text>
              <text x={x + bw / 2} y={H - 4} textAnchor="middle" className="fill-ink-400 text-[10px]">{r.rep}</text>
            </g>
          );
        })}
      </svg>
      <Legend items={[{ label: t('endOfRep'), color: '#F97316' }, { label: t('lowestInRecovery'), color: '#22C55E' }]} />
      <Insight>{t('recoveryNote', { range: `\u2066${lowest}–${highest}\u2069` })}</Insight>
    </Card>
  );
}

export function TechniqueChart({ items }: { items: RunAnalysisData['technique'] }) {
  const t = useTranslations('runAnalysis');
  if (items.length < 2) return null;
  const W = 330; const H = 150; const PT = 14; const PB = 20; const ih = H - PT - PB; const iw = W - 40; const n = items.length; const slot = iw / n;
  const st = items.map((x) => x.stride); const cd = items.map((x) => x.cadence);
  const slo = Math.min(...st) - 0.05; const shi = Math.max(...st) + 0.05; const clo = Math.min(...cd) - 3; const chi = Math.max(...cd) + 3;
  const ys = (v: number) => PT + ((shi - v) / (shi - slo)) * ih; const yc = (v: number) => PT + ((chi - v) / (chi - clo)) * ih;
  const x = (i: number) => 4 + i * slot + slot / 2;
  const first = items[0]; const best = items.reduce((m, v) => (v.stride > m.stride ? v : m), items[0]);
  return (
    <Card title={t('techniqueTitle')} sub={t('techniqueSub')}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" style={{ height: H, direction: 'ltr' }} role="img">
        {[slo + 0.05, (slo + shi) / 2, shi - 0.05].map((v) => <g key={v}><line x1={4} x2={4 + iw} y1={ys(v)} y2={ys(v)} stroke="#EEF0F4" /><text x={W - 2} y={ys(v) + 3.5} textAnchor="end" className="fill-ink-400 text-[10px]">{v.toFixed(2)}</text></g>)}
        <polyline points={items.map((v, i) => `${x(i)},${ys(v.stride)}`).join(' ')} fill="none" stroke={BLUE} strokeWidth={2.2} />
        <polyline points={items.map((v, i) => `${x(i)},${yc(v.cadence)}`).join(' ')} fill="none" stroke={TEAL} strokeWidth={2.2} />
        {items.map((v, i) => <g key={i}><circle cx={x(i)} cy={ys(v.stride)} r={3} fill={BLUE} /><circle cx={x(i)} cy={yc(v.cadence)} r={3} fill={TEAL} /><text x={x(i)} y={H - 4} textAnchor="middle" className="fill-ink-400 text-[10px]">{v.rep}</text></g>)}
      </svg>
      <Legend items={[{ label: t('strideM'), color: BLUE }, { label: t('cadence'), color: TEAL }]} />
      <Insight>{t('techniqueNote', { rep: best.rep, stride: best.stride.toFixed(2), cad: best.cadence, cad0: first.cadence })}</Insight>
    </Card>
  );
}

export function PaceHrScatter({ view, bands }: { view: StreamView; bands: Array<[number, number]> }) {
  const t = useTranslations('runAnalysis');
  if (!view.hr) return null;
  const pts = view.t.map((tt, i) => ({ p: view.pace[i], h: view.hr![i], rep: bands.some(([a, b]) => tt >= a && tt <= b) }))
    .filter((x): x is { p: number; h: number; rep: boolean } => x.p != null && x.h != null && x.p < 420 && x.h > 60);
  if (pts.length < 20) return null;
  const W = 330; const H = 190; const PT = 10; const PB = 22; const PL = 6; const ih = H - PT - PB; const iw = W - PL - 34;
  const plo = Math.min(...pts.map((x) => x.p)) - 5; const phi = Math.min(420, Math.max(...pts.map((x) => x.p)) + 5);
  const hlo = Math.min(...pts.map((x) => x.h)) - 5; const hhi = Math.max(...pts.map((x) => x.h)) + 5;
  const X = (p: number) => PL + ((phi - p) / (phi - plo)) * iw; const Y = (h: number) => PT + ((hhi - h) / (hhi - hlo)) * ih;
  const pt: number[] = []; for (let v = Math.ceil(plo / 30) * 30; v <= phi; v += 30) pt.push(v);
  const ht: number[] = []; for (let v = Math.ceil(hlo / 20) * 20; v <= hhi; v += 20) ht.push(v);
  return (
    <Card title={t('paceVsHr')} sub={t('paceVsHrSub')}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" style={{ height: H, direction: 'ltr' }} role="img">
        {ht.map((v) => <g key={v}><line x1={PL} x2={PL + iw} y1={Y(v)} y2={Y(v)} stroke="#EEF0F4" /><text x={W - 2} y={Y(v) + 3.5} textAnchor="end" className="fill-ink-400 text-[10px]">{v}</text></g>)}
        {pt.map((v) => <text key={v} x={X(v)} y={H - 6} textAnchor="middle" className="fill-ink-400 text-[10px]">{formatPace(v)}</text>)}
        {pts.map((x, i) => <circle key={i} cx={X(x.p)} cy={Y(x.h)} r={2.2} fill={x.rep ? BLUE : '#9AA3C7'} fillOpacity={x.rep ? 0.75 : 0.45} />)}
      </svg>
      <Legend items={[{ label: t('inReps'), color: BLUE }, { label: t('restOfRun'), color: '#9AA3C7' }]} />
      <Insight>{t('scatterNote')}</Insight>
    </Card>
  );
}

export function BestEfforts({ a }: { a: RunAnalysisData }) {
  const t = useTranslations('runAnalysis');
  if (!a.efforts.length) return null;
  return (
    <Card title={t('fastest')} sub={t('fastestSub')}>
      {a.efforts.map((e) => {
        const pr = a.prs[e.key];
        const isPr = pr ? e.seconds <= pr.seconds : false;
        return (
          <div key={e.key} className="flex items-baseline gap-2.5 border-b border-[#F3F4F6] py-2 last:border-0">
            <span className="w-[60px] text-[12.5px] font-extrabold text-ink-400">{t(`effort_${e.key}`)}</span>
            <b className="text-xl font-black"><B>{clock(e.seconds)}</B></b>
            <em className="text-[11.5px] not-italic text-ink-400"><B>{formatPace(e.seconds / (e.meters / 1000))}</B>/{t('km')}</em>
            <span className="ms-auto text-[11.5px] font-bold">
              {isPr ? <span className="text-[#B45309]">🏆 {t('newPr')}</span>
                : pr ? <span className="text-ink-400">{t('prIs', { time: clock(pr.seconds) })}</span>
                  : e.rep ? <span className="text-brand-600">{t('inRep', { n: e.rep })}</span> : null}
            </span>
          </div>
        );
      })}
    </Card>
  );
}

export function Times({ total, moving }: { total: number; moving: number | null }) {
  const t = useTranslations('runAnalysis');
  const net = moving && moving <= total ? moving : total;
  const pause = Math.max(0, total - net);
  return (
    <section className="rounded-card bg-card p-3.5">
      <div className="flex gap-2">
        {([[clock(total), t('totalTime'), ''], [clock(net), t('netTime'), ''], [clock(pause), t('pauseTime'), 'p']] as const).map(([v, l, k]) => (
          <div key={l} className={cn('flex flex-1 flex-col rounded-[14px] p-2.5', k ? 'bg-[#FFF4E5]' : 'bg-[#F4F5F8]')}><b className={cn('text-lg font-black', k && 'text-[#B45309]')}><B>{v}</B></b><span className="text-[11px] text-ink-400">{l}</span></div>
        ))}
      </div>
    </section>
  );
}

export function Conditions({ c }: { c: NonNullable<RunAnalysisData['conditions']> }) {
  const t = useTranslations('runAnalysis');
  return (
    <section className="rounded-card bg-card p-3.5">
      <div className="flex gap-2">
        {([[`${Math.round(c.tempC)}°`, t('temp')], ...(c.feelsC != null ? [[`${Math.round(c.feelsC)}°`, t('feels')] as const] : []), [`${Math.round(c.humidity)}%`, t('humidity')]] as const).map(([v, l]) => (
          <div key={l} className="flex flex-1 flex-col rounded-[14px] bg-[#F4F5F8] p-2.5"><b className="text-lg font-black"><B>{v}</B></b><span className="text-[11px] text-ink-400">{l}</span></div>
        ))}
        <div className="flex flex-1 flex-col rounded-[14px] bg-[#FFF4E5] p-2.5"><b className="text-lg font-black text-[#B45309]"><B>{c.costSec > 0 ? `+${c.costSec}″` : '0″'}</B></b><span className="text-[11px] text-[#8A4A0B]">{t('heatCost')}</span></div>
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-ink-500">{t('dewLine', { dew: Math.round(c.dewC) })} {c.costSec >= 5 ? t('heatHigh', { s: c.costSec }) : c.costSec > 0 ? t('heatLow', { s: c.costSec }) : t('heatNone')}</p>
    </section>
  );
}
