'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/api';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { cn } from '@/lib/utils';
import { Card, Spinner } from '@/components/ui';
import { AthleteLink } from '@/components/AthleteLink';
import { laneStages, type JourneyPerson, type LaneStage } from '@/lib/onboarding/journey';

// ═════════════════════════════════════════════════════════════════════════════
// /dashboard/onboarding-funnel — the joining journey, both lanes (2026-10-19).
//
// Ofer: "I want to press a step and see who is stuck there". Two funnels (club,
// academy) whose steps are buttons; the list below shows whoever is standing at
// the chosen step — or, with nothing chosen, everybody stuck — each with what the
// club already sent them and the one action that moves them on. Placement rules
// live in lib/onboarding/journey.ts.
// ═════════════════════════════════════════════════════════════════════════════

interface Lane { stages: LaneStage[]; people: JourneyPerson[] }
interface Data { journey: { club: Lane; academy: Lane }; eventsRecording: boolean }

type Range = '7' | '30' | 'all';
type LaneKey = 'all' | 'club' | 'academy';

const DAY = 86_400_000;

/**
 * Steps whose duration is not a fact: "installed" is only reported since 2026-10-10,
 * so older members look like they took weeks, and "active this week" is when they
 * were last seen, not when they got there.
 */
const NO_DURATION = new Set(['installed', 'active']);

/** "5 ש׳" / "3 ימים" — hours, readable. */
function dur(h: number | null, t: (k: string, v?: Record<string, number>) => string): string {
  if (h == null) return '—';
  if (h < 1) return t('minutes', { n: Math.max(1, Math.round(h * 60)) });
  if (h < 48) return t('hours', { n: Math.round(h) });
  return t('days', { n: Math.round(h / 24) });
}

const shortDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()}.${d.getMonth() + 1}`;
};

export function OnboardingFunnel() {
  const t = useTranslations('onbFunnel');
  const { data, error } = useApi<Data>('/api/admin/onboarding-funnel');
  const [range, setRange] = useState<Range>('30');
  const [lane, setLane] = useState<LaneKey>('all');
  const [picked, setPicked] = useState<{ lane: 'club' | 'academy'; stage: string } | null>(null);
  const [showWaiting, setShowWaiting] = useState(false);

  // The range is a cohort: who STARTED joining in it. Steps and counts are recomputed
  // over that cohort, so "30 days" is a funnel of the last month's joiners.
  const view = useMemo(() => {
    if (!data?.journey) return null;
    const since = range === 'all' ? 0 : Date.now() - Number(range) * DAY;
    const keep = (p: JourneyPerson) => new Date(p.startedAt).getTime() >= since;
    // Counted again over the range's cohort, with the same rules as the server.
    const recount = (l: Lane): Lane => {
      const people = l.people.filter(keep);
      return { people, stages: laneStages(l.stages.map((s) => s.key), people) };
    };
    return { club: recount(data.journey.club), academy: recount(data.journey.academy) };
  }, [data, range]);

  if (error) return <p className="mt-10 text-center text-sm text-accent-red">{t('loadError')}</p>;
  if (!data || !view) return <div className="mt-20 flex justify-center"><Spinner size={28} /></div>;

  const lanes = (['club', 'academy'] as const).filter((k) => lane === 'all' || lane === k);
  const everyone = lanes.flatMap((k) => view[k].people);
  const started = everyone.length;
  const finished = everyone.filter((p) => p.at === null).length;
  const stuckNow = everyone.filter((p) => p.stuck);
  const approvalH = view.club.stages.find((s) => s.key === 'approved')?.medianHours ?? null;

  const listed = (picked
    ? view[picked.lane].people.filter((p) => p.at === picked.stage)
    : everyone.filter((p) => p.at !== null && (p.stuck || showWaiting))
  );
  const stageName = (l: 'club' | 'academy', k: string) => t(`j.${l}.${k}` as never);

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-12" dir="rtl">
      <div className="px-1">
        <h1 className="text-2xl font-bold text-ink-700">{t('j.title')}</h1>
        <p className="mt-1 text-sm text-ink-500">{t('j.subtitle')}</p>
        {!data.eventsRecording && <p className="mt-2 rounded-xl bg-amber-100 px-3 py-2 text-13 text-amber-800">{t('noEvents')}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Seg options={[['30', t('j.range30')], ['7', t('j.range7')], ['all', t('j.rangeAll')]]} value={range} onChange={(v) => { setRange(v as Range); }} />
        <span className="flex-1" />
        <Seg options={[['all', t('j.laneAll')], ['club', t('j.laneClub')], ['academy', t('j.laneAcademy')]]} value={lane} onChange={(v) => { setLane(v as LaneKey); setPicked(null); }} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label={t('j.kpiStarted')} value={String(started)} />
        <Tile label={t('j.kpiFinished')} value={String(finished)} tone="ok" />
        <Tile label={t('j.kpiStuck')} value={String(stuckNow.length)} tone={stuckNow.length ? 'bad' : 'ok'} />
        <Tile label={t('j.kpiApproval')} value={dur(approvalH, t)} hint={t('median')} />
      </div>

      <div className={cn('grid gap-4', lanes.length === 2 && 'md:grid-cols-2')}>
        {lanes.map((l) => (
          <Card key={l}>
            <h2 className="mb-1 text-base font-bold text-ink-700">{l === 'club' ? '👟 ' : '🎓 '}{t(`j.lane_${l}` as never)}</h2>
            <p className="mb-3 text-xs text-ink-500">{t('j.funnelHint')}</p>
            <LaneFunnel
              stages={view[l].stages}
              name={(k) => stageName(l, k)}
              picked={picked?.lane === l ? picked.stage : null}
              onPick={(k) => setPicked((cur) => (cur?.lane === l && cur.stage === k ? null : { lane: l, stage: k }))}
              dur={(h) => dur(h, t)}
              t={t}
            />
          </Card>
        ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-bold text-ink-700">
            {picked
              ? t('j.listAt', { stage: stageName(picked.lane, picked.stage), n: listed.length })
              : showWaiting ? t('j.listWaiting', { n: listed.length }) : t('j.listStuck', { n: listed.length })}
          </h2>
          <span className="flex-1" />
          {picked ? (
            <button type="button" onClick={() => setPicked(null)} className="rounded-pill bg-page px-3 py-1 text-13 font-semibold text-ink-700">{t('j.clearPick')}</button>
          ) : (
            <label className="flex items-center gap-2 text-13 text-ink-500">
              <input type="checkbox" checked={showWaiting} onChange={(e) => setShowWaiting(e.target.checked)} />
              {t('j.showWaiting')}
            </label>
          )}
        </div>
        <p className="mb-1 text-xs text-ink-500">{picked ? t('j.listAtHint') : t('j.listHint')}</p>
        {listed.length === 0 && <p className="py-6 text-center text-sm text-ink-500">{picked ? t('j.emptyAt') : t('j.emptyStuck')}</p>}
        {[...listed].sort((a, b) => Number(b.stuck) - Number(a.stuck) || b.waitingHours - a.waitingHours).map((p) => (
          <PersonRow key={p.key} p={p} stageName={(k) => stageName(p.lane, k)} dur={(h) => dur(h, t)} />
        ))}
      </Card>
    </div>
  );
}

function LaneFunnel({ stages, name, picked, onPick, dur, t }: {
  stages: LaneStage[];
  name: (k: string) => string;
  picked: string | null;
  onPick: (k: string) => void;
  dur: (h: number | null) => string;
  t: ReturnType<typeof useTranslations<'onbFunnel'>>;
}) {
  const top = Math.max(1, stages[0]?.reached ?? 0);
  return (
    <div className="space-y-1">
      {stages.map((s, i) => {
        const prev = i === 0 ? s.reached : stages[i - 1].reached;
        const pct = prev ? Math.round((s.reached / prev) * 100) : 0;
        const width = Math.max(s.reached ? 6 : 0, Math.round((s.reached / top) * 100));
        const on = picked === s.key;
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onPick(s.key)}
            aria-pressed={on}
            className={cn('grid w-full grid-cols-[112px_1fr_64px] items-center gap-2 rounded-xl px-2 py-1.5 text-start transition-colors', on ? 'bg-brand-600/10 ring-2 ring-brand-600' : 'hover:bg-page')}
          >
            <span className="min-w-0">
              <span className="block truncate text-13 font-semibold text-ink-700">{name(s.key)}</span>
              {s.at > 0 && (
                <span className={cn('block text-2xs font-semibold', s.stuck ? 'text-accent-red-ink' : 'text-ink-500')}>
                  {s.stuck ? t('j.hereStuck', { n: s.at, stuck: s.stuck }) : t('j.here', { n: s.at })}
                </span>
              )}
            </span>
            <span className="relative h-7 overflow-hidden rounded-lg bg-page">
              <span className={cn('absolute inset-y-0 start-0 rounded-lg', s.stuck ? 'bg-accent-red' : 'bg-brand-600')} style={{ width: `${width}%` }} />
              <span className={cn('absolute inset-y-0 start-2 flex items-center text-13 font-bold', width > 12 ? 'text-white' : 'text-ink-700')}>{s.reached}</span>
            </span>
            <span className="text-end text-2xs text-ink-500">
              {i > 0 && <b className="block text-13 text-ink-700">{pct}%</b>}
              {i > 0 && s.medianHours != null && !NO_DURATION.has(s.key) && <span>⏱ {dur(s.medianHours)}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const OWNER_TONE: Record<string, string> = { staff: 'bg-accent-red/10 text-accent-red-ink', manager: 'bg-accent-red/10 text-accent-red-ink', coach: 'bg-accent-red/10 text-accent-red-ink' };

function PersonRow({ p, stageName, dur }: { p: JourneyPerson; stageName: (k: string) => string; dur: (h: number | null) => string }) {
  const t = useTranslations('onbFunnel');
  const [result, setResult] = useState<'busy' | 'ok' | 'fail' | null>(null);
  const initials = p.name.split(/\s+/).map((n) => n[0]).join('').toUpperCase().slice(0, 2);

  const post = async (url: string, body: Record<string, string>) => {
    setResult('busy');
    try {
      const res = await fetch(url, { method: 'POST', headers: await bearerHeaders(), body: JSON.stringify(body) });
      setResult(res.ok ? 'ok' : 'fail');
    } catch { setResult('fail'); }
  };

  // The one action that moves this person on, from where they stand.
  let action: React.ReactNode = null;
  const btn = 'inline-flex shrink-0 rounded-xl px-3 py-2 text-13 font-bold';
  if (p.lane === 'academy') {
    action = <Link href="/dashboard/academy?tab=funnel" className={cn(btn, 'bg-brand-600 text-white')}>{t('j.actCard')}</Link>;
  } else if (p.at === 'approved') {
    action = <Link href={`/dashboard/entry-queue?at=mine&q=${encodeURIComponent(p.name)}`} className={cn(btn, 'bg-brand-600 text-white')}>{t('j.actApprove')}</Link>;
  } else if (p.at === 'link' && p.requestId && !p.strava) {
    action = <button type="button" disabled={result === 'busy' || result === 'ok'} onClick={() => post('/api/admin/registrations/resend', { id: p.requestId! })} className={cn(btn, 'bg-brand-600 text-white disabled:opacity-60')}>{t('j.actResend')}</button>;
  } else if (p.at && p.athleteId) {
    action = <button type="button" disabled={result === 'busy' || result === 'ok'} onClick={() => post('/api/admin/entry-queue/nudge', { athleteId: p.athleteId! })} className={cn(btn, 'bg-brand-600 text-white disabled:opacity-60')}>{t('j.actNudge')}</button>;
  }

  const who = p.athleteId
    ? <AthleteLink athleteId={p.athleteId} name={p.name} className="font-bold text-ink-700"><span dir="auto">{p.name}</span></AthleteLink>
    : <b className="text-ink-700" dir="auto">{p.name}</b>;

  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-2 border-t border-page py-3 first:border-t-0">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600/15 text-xs font-bold text-brand-600">{initials}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {who}
          {p.at && (
            <span className={cn('rounded-pill px-2 py-0.5 text-2xs font-bold', p.stuck ? 'bg-accent-red/10 text-accent-red-ink' : 'bg-amber-100 text-amber-800')}>
              {p.stuck ? t('j.tagStuck') : t('j.tagWaiting')}
            </span>
          )}
          {p.owner && <span className={cn('rounded-pill px-2 py-0.5 text-2xs font-bold', OWNER_TONE[p.owner] ?? 'bg-page text-ink-500')}>{t(`j.owner.${p.owner}` as never)}</span>}
          {p.strava && p.at === 'approved' && (
            <span className={cn('rounded-pill px-2 py-0.5 text-2xs font-bold', p.notifyEmail ? 'bg-accent-900/10 text-accent-900' : 'bg-accent-red/10 text-accent-red-ink')}>
              {p.notifyEmail ? t('j.reachEmail') : t('j.reachNone')}
            </span>
          )}
        </div>
        {p.at && (
          <p className="text-13 text-ink-500">
            {t('j.atLine', { stage: stageName(p.at), wait: dur(p.waitingHours) })}
            <span className="text-ink-400"> · {t('j.startedOn', { date: shortDate(p.startedAt) })}</span>
          </p>
        )}
        {p.sent.length > 0 ? (
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-ink-500">
            {p.sent.slice(0, 5).map((s, i) => (
              <span key={i} className={cn(!s.ok && 'text-accent-red-ink')}>
                {s.kind === 'email' ? '✉️' : '🔔'} {t.has(`j.sent.${s.key}` as never) ? t(`j.sent.${s.key}` as never) : s.key} · {shortDate(s.at)}{!s.ok && ` · ${t('j.sentFailed')}`}
              </span>
            ))}
          </p>
        ) : (
          p.at && <p className="mt-1 text-2xs text-ink-400">{t('j.sentNone')}</p>
        )}
        {result === 'ok' && <p className="mt-1 text-2xs font-bold text-accent-900">✓ {t('j.actDone')}</p>}
        {result === 'fail' && <p className="mt-1 text-2xs font-bold text-accent-red-ink">{t('j.actFailed')}</p>}
      </div>
      {/* Under the text on a phone, beside it on a computer. */}
      {action && <div className="basis-full ps-12 sm:basis-auto sm:ps-0">{action}</div>}
    </div>
  );
}

function Seg({ options, value, onChange }: { options: Array<[string, string]>; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1 rounded-pill bg-card p-1">
      {options.map(([k, label]) => (
        <button key={k} type="button" onClick={() => onChange(k)} aria-pressed={value === k}
          className={cn('rounded-pill px-3 py-1.5 text-13 font-semibold', value === k ? 'bg-brand-600 text-white' : 'text-ink-500')}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'ok' | 'bad' }) {
  return (
    <div className="rounded-card bg-card p-4">
      <p className="text-xs text-ink-500">{label}</p>
      <p className={cn('mt-1 text-2xl font-bold', tone === 'bad' ? 'text-accent-red-ink' : tone === 'ok' ? 'text-accent-900' : 'text-ink-700')}>{value}</p>
      {hint && <p className="text-2xs text-ink-400">{hint}</p>}
    </div>
  );
}
