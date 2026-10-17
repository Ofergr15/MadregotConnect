'use client';

/**
 * The run page's sections below the charts — the 2.41.x redesign (mockup A,
 * ~/.cache/madregot/feed-pro/options.html): the headline stat grid, the watch's
 * laps, time in each heart-rate zone, and the kilometre splits.
 *
 * Every section takes what the trace gives when there is one and the per-km splits
 * otherwise, so a Strava-only run gets the same page, coarser.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StreamKmSplit } from '@/lib/activities/stream-view';
import { HR_ZONE_FLOORS } from '@/lib/activities/stream-view';
import { formatDuration, formatPace } from './format';
import type { Split } from './types';

/** Numbers inside Hebrew text need LTR isolation. */
export function Num({ children, className }: { children: React.ReactNode; className?: string }) {
  return <bdi dir="ltr" className={cn('tabular-nums', className)}>{children}</bdi>;
}

export function Section({ title, aside, children, className }: { title?: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-card border border-page bg-card p-4', className)}>
      {title && (
        <div className="mb-3 flex items-baseline gap-2">
          <h2 className="text-base font-extrabold text-ink-700">{title}</h2>
          {aside && <span className="text-xs text-ink-400">{aside}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

// ── Stat grid ───────────────────────────────────────────────────────────────

export interface StatCell { label: string; value: string | null; unit?: string }

/** 3 columns, hairline dividers — the run's headline numbers. Missing values drop out. */
export function StatGrid({ cells, more }: { cells: StatCell[]; more?: StatCell[] }) {
  const t = useTranslations('runPage');
  const [open, setOpen] = useState(false);
  const shown = cells.filter((c) => c.value);
  const extra = (more || []).filter((c) => c.value);
  return (
    <div>
      <div className="grid grid-cols-3 gap-y-4">
        {shown.map((c, i) => (
          <div key={c.label} className={cn('min-w-0 px-3', i % 3 === 0 ? 'ps-0' : 'border-s border-page')}>
            <p className="truncate text-xs text-ink-400">{c.label}</p>
            <p className="truncate text-xl font-bold text-ink-700">
              <Num>{c.value}</Num>
              {c.unit && <span className="ms-1 text-xs font-medium text-ink-400">{c.unit}</span>}
            </p>
          </div>
        ))}
      </div>
      {extra.length > 0 && (
        <>
          {open && (
            <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-2">
              {extra.map((c) => (
                <div key={c.label} className="flex items-baseline justify-between gap-2 border-b border-page pb-2 text-sm">
                  <dt className="text-ink-400">{c.label}</dt>
                  <dd className="font-bold text-ink-700"><Num>{c.value}</Num>{c.unit && <span className="ms-1 text-xs font-medium text-ink-400">{c.unit}</span>}</dd>
                </div>
              ))}
            </dl>
          )}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="mt-3 flex h-11 w-full items-center justify-center gap-1 rounded-xl bg-brand-600/5 text-sm font-semibold text-brand-600"
          >
            {open ? t('lessStats') : t('moreStats')}
            <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
          </button>
        </>
      )}
    </div>
  );
}

// ── Heart-rate zones ────────────────────────────────────────────────────────

/** Same fills as `getHRZone`'s bgColor — used as bar fills only, never as text. */
const ZONE_FILL = ['#969696', '#60a5fa', '#16a34a', '#fb923c', '#D74E4E'];

export function HrZones({ seconds, maxHr }: { seconds: number[]; maxHr: number }) {
  const t = useTranslations('runPage');
  const total = seconds.reduce((a, b) => a + b, 0);
  if (!total) return null;
  return (
    <Section title={t('zonesTitle')}>
      <div className="space-y-2">
        {[4, 3, 2, 1, 0].map((z) => {
          const pct = seconds[z] / total;
          return (
            <div key={z} className="grid grid-cols-[88px_1fr_88px] items-center gap-2 text-xs">
              <span><b className="text-ink-700">Z{z + 1}</b> <span className="text-ink-400">{t(`zone${z + 1}` as 'zone1')}</span></span>
              <div dir="ltr" className="h-3 overflow-hidden rounded-full bg-page/60">
                <div className="h-full rounded-full" style={{ width: `${pct > 0 ? Math.max(pct * 100, 2) : 0}%`, background: ZONE_FILL[z] }} />
              </div>
              <span className="text-end text-ink-500"><Num>{Math.round(pct * 100)}%</Num> · <Num>{formatDuration(seconds[z])}</Num></span>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-2xs text-ink-400">
        {t('zonesBasis', { max: maxHr })}{' '}
        <Num>{`Z4 ${Math.round(maxHr * HR_ZONE_FLOORS[3])}–${Math.round(maxHr * HR_ZONE_FLOORS[4])}`}</Num>
      </p>
    </Section>
  );
}

// ── Laps ───────────────────────────────────────────────────────────────────

export interface LapRow { distance: number; duration: number; pace: number | null; hr: number | null; intensity: string | null }

const EASY_STEPS = new Set(['WARMUP', 'COOLDOWN', 'RECOVERY', 'REST']);

/** Auto-km laps say nothing the splits don't — the caller hides those. */
export function lapsAreKm(laps: LapRow[]): boolean {
  return laps.slice(0, -1).every((l) => Math.abs(l.distance - 1000) < 30);
}

export function Laps({ laps }: { laps: LapRow[] }) {
  const t = useTranslations('runPage');
  const rows = laps.filter((l) => l.distance > 50 && l.pace);
  if (rows.length < 2) return null;
  // Same table as the splits below, on purpose: one way to read a run's pieces.
  // Warm-up, recovery and cool-down rows are muted rather than coloured — the work
  // laps carry the bar, the easy ones only their numbers.
  const work = rows.filter((l) => !(l.intensity && EASY_STEPS.has(l.intensity)));
  const ref = work.length >= 2 ? work : rows;
  const lo = Math.min(...ref.map((l) => l.pace as number));
  const hi = Math.max(...ref.map((l) => l.pace as number));
  return (
    <Section title={t('lapsTitle')} aside={t('lapsCount', { n: rows.length })}>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-2xs text-ink-400">
            <th className="pb-1.5 text-start font-semibold">#</th>
            <th className="pb-1.5 text-start font-semibold">{t('pace')}</th>
            <th className="w-[30%]" />
            <th className="pb-1.5 text-start font-semibold">{t('km')}</th>
            <th className="pb-1.5 text-start font-semibold">♥</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l, i) => {
            const easy = !!l.intensity && EASY_STEPS.has(l.intensity);
            const f = hi === lo ? 1 : 1 - (Math.min(Math.max(l.pace as number, lo), hi) - lo) / (hi - lo);
            return (
              <tr key={i} className={cn('border-t border-page', easy && 'text-ink-400')}>
                <td className="py-2 tabular-nums text-ink-500">{i + 1}</td>
                <td className={cn('py-2 tabular-nums', easy ? 'text-ink-400' : 'font-bold text-ink-700')}>{formatPace(l.pace as number)}</td>
                <td className="py-2">
                  {!easy && <div dir="ltr"><div className="h-2 rounded-full bg-brand-600" style={{ width: `${35 + f * 65}%` }} /></div>}
                </td>
                <td className="py-2 tabular-nums text-ink-500">{(l.distance / 1000).toFixed(2)}</td>
                <td className="py-2 tabular-nums text-ink-700">{l.hr ?? '–'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Section>
  );
}

// ── Kilometre splits ───────────────────────────────────────────────────────

interface KmRow { label: string; pace: number; hr: number | null; elev: number | null; partial: boolean }

function rowsFromStream(km: StreamKmSplit[]): KmRow[] {
  return km.map((k) => ({
    label: k.distance < 950 ? (k.distance / 1000).toFixed(2) : String(k.km),
    pace: k.pace,
    hr: k.hr,
    elev: k.elevationGain - k.elevationLoss,
    partial: k.distance < 950,
  }));
}

function rowsFromSplits(splits: Split[]): KmRow[] {
  return splits.filter((s) => s.averagePace).map((s, i) => ({
    label: s.distance < 950 ? (s.distance / 1000).toFixed(2) : String(i + 1),
    pace: s.averagePace,
    hr: s.averageHR,
    elev: s.elevationGain != null || s.elevationLoss != null ? (s.elevationGain ?? 0) - (s.elevationLoss ?? 0) : null,
    partial: s.distance < 950,
  }));
}

export function KmSplits({ streamKm, splits }: { streamKm: StreamKmSplit[] | null; splits: Split[] }) {
  const t = useTranslations('runPage');
  const [all, setAll] = useState(false);
  const rows = streamKm?.length ? rowsFromStream(streamKm) : rowsFromSplits(splits);
  if (rows.length < 2) return null;
  const full = rows.filter((r) => !r.partial);
  const lo = Math.min(...full.map((r) => r.pace));
  const hi = Math.max(...full.map((r) => r.pace));
  const fastest = full.find((r) => r.pace === lo);
  const LIMIT = 10;
  const shown = all ? rows : rows.slice(0, LIMIT);
  return (
    <Section title={t('splitsTitle')} aside={streamKm?.length ? t('splitsFromTrace') : undefined}>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-2xs text-ink-400">
            <th className="pb-1.5 text-start font-semibold">{t('km')}</th>
            <th className="pb-1.5 text-start font-semibold">{t('pace')}</th>
            <th className="w-[34%]" />
            <th className="pb-1.5 text-start font-semibold">{t('elevationShort')}</th>
            <th className="pb-1.5 text-start font-semibold">♥</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => {
            const w = r.partial ? 20 : 35 + (1 - (r.pace - lo) / ((hi - lo) || 1)) * 65;
            return (
              <tr key={i} className={cn('border-t border-page', r === fastest && 'font-extrabold')}>
                <td className="py-2 tabular-nums text-ink-500">{r.label}</td>
                <td className="py-2 tabular-nums text-ink-700">
                  {formatPace(r.pace)}
                  {r === fastest && <span className="ms-1.5 rounded-full bg-brand-600/10 px-1.5 py-0.5 text-3xs font-bold text-brand-700">{t('fastest')}</span>}
                </td>
                <td className="py-2"><div dir="ltr"><div className={cn('h-2 rounded-full', r.partial ? 'bg-primary-200' : 'bg-brand-600')} style={{ width: `${w}%` }} /></div></td>
                <td className="py-2 tabular-nums text-ink-400"><Num>{r.elev == null ? '–' : `${r.elev > 0 ? '+' : ''}${Math.round(r.elev)}`}</Num></td>
                <td className="py-2 tabular-nums text-ink-700">{r.hr ?? '–'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > LIMIT && !all && (
        <button type="button" onClick={() => setAll(true)} className="mt-2 flex h-11 w-full items-center justify-center gap-1 rounded-xl bg-brand-600/5 text-sm font-semibold text-brand-600">
          {t('allKm', { n: rows.length })} <ChevronDown className="h-4 w-4" />
        </button>
      )}
    </Section>
  );
}
