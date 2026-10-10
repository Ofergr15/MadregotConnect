'use client';

import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Card, Spinner } from '@/components/ui';
import { FUNNEL_STAGES, type FunnelStage, type FunnelSummary, type MemberFunnel, type StuckReason } from '@/lib/onboarding/funnel';

// ═════════════════════════════════════════════════════════════════════════════
// /dashboard/onboarding-funnel — how new members join, on which device, how long
// each step takes, and who is stuck where (lib/onboarding/funnel.ts). Super user
// and approvers. Numbers first (stat tiles), then the funnel as one-hue bars with
// counts written beside them, the stuck list with every reason in words, and one
// row per member, which is also the table view of everything above.
// ═════════════════════════════════════════════════════════════════════════════

interface Data { summary: FunnelSummary; members: MemberFunnel[]; eventsRecording: boolean }

const DEVICE_ICON: Record<string, string> = { computer: '💻', iphone: '📱', ipad: '📱', android: '🤖' };

/** "5 ש׳" / "3 ימים" — hours, readable. */
function dur(h: number | null, t: (k: string, v?: Record<string, number>) => string): string {
  if (h == null) return '—';
  if (h < 1) return t('minutes', { n: Math.max(1, Math.round(h * 60)) });
  if (h < 48) return t('hours', { n: Math.round(h) });
  return t('days', { n: Math.round(h / 24) });
}

export function OnboardingFunnel() {
  const t = useTranslations('onbFunnel');
  const { data, error } = useApi<Data>('/api/admin/onboarding-funnel');
  if (error) return <p className="mt-10 text-center text-sm text-accent-red">{t('loadError')}</p>;
  if (!data) return <div className="mt-20 flex justify-center"><Spinner size={28} /></div>;
  const { summary: s, members } = data;
  const requested = s.stages[0]?.count || 1;
  const stage = (k: FunnelStage) => s.stages.find((x) => x.stage === k);
  const stuck = members.filter((m) => m.stuck.length > 0);

  return (
    <div className="mx-auto max-w-4xl space-y-4 pb-12" dir="rtl">
      <div className="px-1">
        <h1 className="text-2xl font-bold text-ink-700">{t('title')}</h1>
        <p className="mt-1 text-sm text-ink-500">{t('subtitle')}</p>
        {!data.eventsRecording && <p className="mt-2 rounded-xl bg-amber-100 px-3 py-2 text-13 text-amber-800">{t('noEvents')}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label={t('kpiMembers')} value={String(s.members)} />
        <Tile label={t('kpiToApproval')} value={dur(stage('approved')?.medianHours ?? null, t)} hint={t('median')} />
        <Tile label={t('kpiActivated')} value={`${s.activated48h}/${s.members}`} hint={t('kpiActivatedHint')} />
        <Tile label={t('kpiStuck')} value={String(s.stuck)} tone={s.stuck ? 'bad' : 'ok'} />
      </div>

      <Card>
        <h2 className="text-base font-bold text-ink-700">{t('funnelTitle')}</h2>
        <p className="mb-3 text-xs text-ink-500">{t('funnelHint')}</p>
        <div className="space-y-2.5">
          {FUNNEL_STAGES.map((k) => {
            const st = stage(k)!;
            const pct = Math.round((st.count / requested) * 100);
            return (
              <div key={k} className="grid grid-cols-[110px_1fr_auto] items-center gap-3" title={`${t(`stage.${k}`)}: ${st.count} (${pct}%) · ${t('median')} ${dur(st.medianHours, t)}`}>
                <span className="text-sm text-ink-700">{t(`stage.${k}`)}</span>
                <span className="h-3 rounded-[4px] bg-page">
                  <span className="block h-3 rounded-[4px] bg-brand-600" style={{ width: `${Math.max(pct, st.count ? 3 : 0)}%` }} />
                </span>
                <span className="w-[150px] text-end text-13 text-ink-500">
                  <b className="text-ink-700">{st.count}</b> · {pct}%{k !== 'requested' && <span className="text-ink-400"> · {dur(st.medianHours, t)}</span>}
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      {stuck.length > 0 && (
        <Card>
          <h2 className="text-base font-bold text-ink-700">{t('stuckTitle')}</h2>
          <p className="mb-2 text-xs text-ink-500">{t('stuckHint')}</p>
          {stuck.map((m) => (
            <div key={m.athleteId ?? m.name} className="flex flex-wrap items-center gap-2 border-t border-page py-2.5 first:border-t-0">
              <b className="min-w-[120px] text-sm text-ink-700">{m.name}</b>
              {m.stuck.map((r) => <StuckChip key={r.reason} reason={r.reason} since={dur(r.sinceHours, t)} />)}
            </div>
          ))}
        </Card>
      )}

      <Card>
        <h2 className="text-base font-bold text-ink-700">{t('devicesTitle')}</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {Object.entries(s.devices).length === 0 && <span className="text-13 text-ink-500">{t('devicesNone')}</span>}
          {Object.entries(s.devices).sort((a, b) => b[1] - a[1]).map(([d, n]) => (
            <span key={d} className="rounded-pill bg-page px-3 py-1 text-13 text-ink-700">{DEVICE_ICON[d] ?? '•'} {t(`device.${d}`)} · <b>{n}</b></span>
          ))}
        </div>
      </Card>

      <Card className="overflow-x-auto">
        <h2 className="mb-2 text-base font-bold text-ink-700">{t('membersTitle')}</h2>
        <table className="w-full min-w-[720px] text-13">
          <thead>
            <tr className="text-start text-ink-500">
              <th className="py-2 text-start font-semibold">{t('colMember')}</th>
              {FUNNEL_STAGES.slice(1).map((k) => <th key={k} className="py-2 text-start font-semibold">{t(`stage.${k}`)}</th>)}
              <th className="py-2 text-start font-semibold">{t('colDevices')}</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.athleteId ?? m.name} className="border-t border-page align-top">
                <td className="py-2">
                  <b className="block text-ink-700">{m.name}</b>
                  <span className="text-2xs text-ink-400">{m.requestedAt?.slice(0, 10)} · {t(`source.${m.source ?? 'direct'}`)}</span>
                </td>
                {FUNNEL_STAGES.slice(1).map((k) => (
                  <td key={k} className="py-2">
                    {m.reached[k] ? <span className="text-ink-700">✓ <span className="text-ink-500">{dur(m.hours[k], t)}</span></span> : <span className="text-ink-300">—</span>}
                  </td>
                ))}
                <td className="py-2">{m.devices.map((d) => DEVICE_ICON[d] ?? '•').join(' ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-2xs text-ink-400">{t('tableHint')}</p>
      </Card>
    </div>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'ok' | 'bad' }) {
  return (
    <div className="rounded-card bg-card p-4">
      <p className="text-xs text-ink-500">{label}</p>
      <p className={cn('mt-1 text-2xl font-bold', tone === 'bad' ? 'text-accent-red-ink' : 'text-ink-700')}>{value}</p>
      {hint && <p className="text-2xs text-ink-400">{hint}</p>}
    </div>
  );
}

function StuckChip({ reason, since }: { reason: StuckReason; since: string }) {
  const t = useTranslations('onbFunnel');
  const icon = reason === 'awaiting_approval' || reason === 'approved_not_opened' ? '⛔' : '⚠️';
  return <span className="rounded-pill bg-accent-red/10 px-2.5 py-1 text-xs text-accent-red-ink">{icon} {t(`stuck.${reason}`)} · {since}</span>;
}
