'use client';

import { useState } from 'react';
import { Gauge } from 'lucide-react';
import { apiHeaders, useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Sheet } from '@/components/ui';
import { formatPace, parsePaceString } from '@/lib/garmin/pace';
import { ZONE_INTENSITY, zoneCentrePace } from '@/lib/academy/library';

// ═════════════════════════════════════════════════════════════════════════════
// The trainee's pace zones as the coach sees them (Ofer, 2026-10-20, mockups/coach-baseline):
// each zone is a SUGGESTED pace with a ✎ for whoever wants to change it. ✎ opens that one row
// (type a pace, or ± 5 s) with "שמירה" and "↺ חזרה למוצע"; an edited row reads
// "4:05 · נקבע ע״י המאמן (מוצע 4:12)". The trainee never sees this — their tiles just carry
// the number. Stored by /api/academy/zones (an academy_coach_decisions row, kind 'pace').
// ═════════════════════════════════════════════════════════════════════════════

export const ZONE_LABEL: Record<string, string> = {
  easy: 'קל', marathon_pace: 'קצב מרתון', tempo: 'טמפו', threshold: 'סף', interval: 'אינטרוולים', sprint: 'ספרינט',
};
const STEP = 5;

interface ZonesResponse {
  basis: 'test' | 'band' | 'coach' | null;
  basisDate: string | null;
  thresholdSec: number | null;
  zones: Array<{ zone: string; suggested: number | null; set: number | null }>;
  lapsed: { since: string; zones: Record<string, number> } | null;
}

const BASIS_LINE: Record<string, string> = {
  test: 'מוצע לפי הטסט',
  coach: 'מוצע לפי בסיס הקצב',
  band: 'מוצע לפי הדבוקה',
};

function Pace({ sec, className }: { sec: number; className?: string }) {
  return <bdi dir="ltr" className={cn('tabular-nums', className)}>{formatPace(sec)}</bdi>;
}

/**
 * The rows. `previewThresholdSec`: the baseline being typed, not saved yet — the suggestions
 * follow it live and ✎ waits for the save. Otherwise the saved zones are read from the API.
 */
export function ZoneRows({ athleteId, previewThresholdSec, onSaved }: {
  athleteId: string; previewThresholdSec?: number | null; onSaved?: () => void;
}) {
  const preview = previewThresholdSec !== undefined;
  const { data, mutate } = useApi<ZonesResponse>(preview ? null : `/api/academy/zones?athleteId=${encodeURIComponent(athleteId)}`, { shouldRetryOnError: false });
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const rows = preview
    ? Object.keys(ZONE_INTENSITY).map((zone) => ({ zone, suggested: previewThresholdSec ? zoneCentrePace(previewThresholdSec, zone) : null, set: null as number | null }))
    : data?.zones ?? [];
  if (!preview && !data) return null;
  if (!rows.some((r) => r.suggested)) return null;

  const setOf = () => Object.fromEntries(rows.filter((r) => r.set != null).map((r) => [r.zone, r.set as number]));
  const put = async (zones: Record<string, number>) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/academy/zones', { method: 'PUT', headers: await apiHeaders(true), body: JSON.stringify({ athleteId, zones }) });
      if (!res.ok) { setErr('לא נשמר — נסו שוב'); return; }
      setOpen(null);
      await mutate();
      onSaved?.();
    } catch {
      setErr('לא נשמר — נסו שוב');
    } finally {
      setBusy(false);
    }
  };
  const draftSec = parsePaceString(draft);

  return (
    <div className="space-y-1.5">
      {!preview && data?.basis && <p className="px-1 text-[12px] font-bold text-ink-400">{BASIS_LINE[data.basis]}</p>}
      {!preview && data?.lapsed && (
        <p className="rounded-xl bg-[#FDF0E2] px-3 py-2 text-[12.5px] font-bold leading-snug text-[#8A4308]">
          הטסט החדש החליף את הקצבים שקבעת ביד — אלה הקצבים המוצעים לפיו.
        </p>
      )}
      {rows.map((r) => {
        if (!r.suggested) return null;
        const isOpen = open === r.zone;
        const value = r.set ?? r.suggested;
        return (
          <div key={r.zone} className={cn('rounded-xl border-[1.5px] bg-white px-3', isOpen ? 'border-brand-600' : r.set != null ? 'border-[#F59E0B]' : 'border-[#E4E5EC]')}>
            <div className="flex min-h-[52px] items-center gap-2">
              <span className="min-w-0 flex-1 text-[14px]">
                {r.set != null ? (
                  <>
                    <b className="text-ink-900">{ZONE_LABEL[r.zone] ?? r.zone} · <Pace sec={r.set} /></b>{' '}
                    <small className="text-[12px] font-bold text-[#B45309]">· נקבע ע״י המאמן (מוצע <Pace sec={r.suggested} />)</small>
                  </>
                ) : (
                  <>
                    <b className="text-ink-900">{ZONE_LABEL[r.zone] ?? r.zone}</b>{' '}
                    <span className="text-ink-500">· קצב מוצע </span><Pace sec={r.suggested} className="font-black text-ink-900" />
                  </>
                )}
              </span>
              <button type="button" aria-label={`עריכת ${ZONE_LABEL[r.zone] ?? r.zone}`} disabled={preview}
                onClick={() => { setOpen(isOpen ? null : r.zone); setDraft(formatPace(value)); setErr(null); }}
                className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-full text-[16px]', isOpen ? 'bg-brand-600 text-white' : 'bg-page text-brand-600', preview && 'opacity-40')}>
                ✎
              </button>
            </div>
            {isOpen && (
              <div className="border-t border-page pb-3 pt-2.5">
                <div className="flex items-center justify-center gap-3">
                  <button type="button" aria-label="איטי ב־5 שניות" onClick={() => setDraft(formatPace((draftSec || value) + STEP))}
                    className="grid h-11 w-11 place-items-center rounded-full bg-page text-[20px] font-black text-ink-700">−</button>
                  <input value={draft} onChange={(e) => setDraft(e.target.value)} inputMode="numeric" dir="ltr" aria-label="קצב לק״מ"
                    className="w-[96px] rounded-xl border-[1.5px] border-brand-600 px-2 py-1.5 text-center text-[22px] font-black tabular-nums text-ink-900 focus:outline-none" />
                  <button type="button" aria-label="מהיר ב־5 שניות" onClick={() => setDraft(formatPace((draftSec || value) - STEP))}
                    className="grid h-11 w-11 place-items-center rounded-full bg-page text-[20px] font-black text-ink-700">+</button>
                </div>
                <p className="mt-1 text-center text-[11.5px] text-ink-400">אפשר להקליד, או ± 5 שניות · מוצע <Pace sec={r.suggested} /></p>
                {err && <p className="mt-1 text-center text-[12px] font-bold text-accent-red-ink" role="alert">{err}</p>}
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button type="button" disabled={busy || !(draftSec >= 150 && draftSec <= 600)}
                    onClick={() => void put({ ...setOf(), [r.zone]: draftSec })}
                    className="min-h-[44px] rounded-xl bg-brand-600 text-[14.5px] font-extrabold text-white disabled:opacity-50">שמירה</button>
                  <button type="button" disabled={busy}
                    onClick={() => { const { [r.zone]: _drop, ...rest } = setOf(); void _drop; void put(rest); }}
                    className="min-h-[44px] rounded-xl bg-page text-[14px] font-extrabold text-ink-700">↺ חזרה למוצע</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {preview && <p className="px-1 text-[11.5px] text-ink-400">✎ אחרי שמירת הבסיס — לכל מי שרוצה לשנות אזור.</p>}
    </div>
  );
}

/** The trainee page's "קצבים" row: the zones, editable, in a sheet. Nothing for a non-coach. */
export function ZonesRow({ athleteId }: { athleteId: string }) {
  const { data } = useApi<ZonesResponse>(`/api/academy/zones?athleteId=${encodeURIComponent(athleteId)}`, { shouldRetryOnError: false });
  const [open, setOpen] = useState(false);
  if (!data || !Array.isArray(data.zones) || !data.thresholdSec) return null;
  const edited = data.zones.filter((z) => z.set != null).length;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="flex min-h-[52px] w-full items-center gap-3 rounded-card border border-page bg-card px-4 py-2.5 text-start">
        <Gauge className="h-5 w-5 shrink-0 text-brand-600" />
        <span className="min-w-0 flex-1">
          <b className="block text-[14.5px] text-ink-900">קצבים</b>
          <small className="block truncate text-[12px] text-ink-400">
            {data.basis ? BASIS_LINE[data.basis] : ''}{edited ? ` · ${edited === 1 ? 'אזור אחד נקבע ביד' : `${edited} אזורים נקבעו ביד`}` : ''}
          </small>
        </span>
        <span className="shrink-0 text-[15px] text-brand-600">✎</span>
      </button>
      <Sheet open={open} onOpenChange={setOpen} title="קצבים">
        <div className="px-4 pb-6" dir="rtl"><ZoneRows athleteId={athleteId} /></div>
      </Sheet>
    </>
  );
}
