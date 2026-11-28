'use client';

import Link from 'next/link';
import { Timer } from 'lucide-react';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';

// ═════════════════════════════════════════════════════════════════════════════
// ניהול ← ריצות אוטומטיות (task 93): the last run of every cron from /api/admin/cron-runs —
// when, how long, ok or failed, and its counts. A run a staff member started by hand carries
// a 'ידני' badge (product decision 28.11: counts.trigger = 'manual', see lib/cron/runs.ts).
// ═════════════════════════════════════════════════════════════════════════════

interface Run { name: string; started_at: string; finished_at: string | null; ok: boolean | null; http_status: number | null; counts: Record<string, unknown> | null; error: string | null }
interface Data { summary?: Array<{ name: string; last: Run; open: boolean; failedRecently: number; manualRecently: number }>; runs?: Run[]; migrated?: false }

const when = (iso: string) => new Date(iso).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });
const secs = (r: Run) => (r.finished_at ? Math.max(0, Math.round((Date.parse(r.finished_at) - Date.parse(r.started_at)) / 1000)) : null);
const isManual = (r: Run) => r.counts?.trigger === 'manual';
const countsLine = (r: Run) => Object.entries(r.counts ?? {}).filter(([k]) => k !== 'trigger' && k !== 'staff_athlete_id').map(([k, v]) => `${k} ${v}`).join(' · ');

export default function CronRunsPage() {
  const { data, error } = useApi<Data>('/api/admin/cron-runs?limit=200', { refreshInterval: 60_000 });
  const notMigrated = data?.migrated === false || (error as { status?: number } | undefined)?.status === 503;
  return (
    <div className="pb-10" dir="rtl">
      <Link href="/dashboard/coach-tools" className="inline-flex min-h-[44px] items-center text-[17px] text-[#007aff]">‹ ניהול</Link>
      <div className="flex items-center gap-3 pb-3">
        <span className="grid h-[44px] w-[44px] place-items-center rounded-[12px] bg-[#5856D6] text-white"><Timer className="h-6 w-6" /></span>
        <h1 className="text-[28px] font-extrabold tracking-[-0.4px] text-ink-900">ריצות אוטומטיות</h1>
      </div>
      {!data && !error && <div className="h-48 animate-pulse rounded-[16px] bg-card" />}
      {notMigrated && <p className="rounded-[16px] bg-card px-4 py-4 text-[14px] text-ink-600">מחכה למיגרציה 251 (cron_runs). עד אז הריצות עובדות כרגיל, רק בלי מעקב.</p>}
      {data?.summary && (
        <ul className="divide-y divide-[#e5e5ea] rounded-[16px] bg-card">
          {data.summary.map(({ name, last, open, failedRecently }) => (
            <li key={name} className="px-4 py-3">
              <div className="flex items-center gap-2">
                <bdi dir="ltr" className="text-[16px] font-bold text-ink-900">{name}</bdi>
                {isManual(last) && <span data-testid="manual-badge" className="rounded-full bg-[#EDE9FE] px-2 py-0.5 text-[12px] font-bold text-[#6d28d9]">ידני</span>}
                <span className={cn('ms-auto rounded-full px-2 py-0.5 text-[12px] font-bold',
                  open ? 'bg-[#FEF3C7] text-[#b45309]' : last.ok ? 'bg-[#DCFCE7] text-[#15803d]' : 'bg-[#FEE2E2] text-[#b91c1c]')}>
                  {open ? '⏳ פתוחה' : last.ok ? '✓ הצליחה' : '✗ נכשלה'}
                </span>
              </div>
              <p className="mt-0.5 text-[13px] text-ink-500">
                {when(last.started_at)}{secs(last) != null && <> · <bdi dir="ltr">{secs(last)}s</bdi></>}
                {failedRecently > 0 && <> · {failedRecently} כשלונות לאחרונה</>}
              </p>
              {countsLine(last) && <p className="mt-0.5 text-[12px] text-ink-400"><bdi dir="ltr">{countsLine(last)}</bdi></p>}
              {last.error && <p className="mt-0.5 text-[12px] text-[#b91c1c]"><bdi dir="ltr">{last.error}</bdi></p>}
            </li>
          ))}
        </ul>
      )}
      {data?.runs && data.runs.some(isManual) && (
        <section className="mt-4 rounded-[16px] bg-card p-3.5">
          <p className="text-[12.5px] font-bold text-ink-500">הפעלות ידניות אחרונות</p>
          {data.runs.filter(isManual).slice(0, 20).map((r) => (
            <p key={`${r.name}-${r.started_at}`} className="mt-1 text-[13px] text-ink-700">
              <span className="rounded-full bg-[#EDE9FE] px-2 py-0.5 text-[11px] font-bold text-[#6d28d9]">ידני</span>{' '}
              <bdi dir="ltr">{r.name}</bdi> · {when(r.started_at)} · {r.ok ? '✓' : r.ok === false ? '✗' : '⏳'}
            </p>
          ))}
        </section>
      )}
    </div>
  );
}
