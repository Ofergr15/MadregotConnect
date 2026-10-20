'use client';

import { useEffect, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { apiHeaders, useApi } from '@/lib/api';
import { cn, israelToday } from '@/lib/utils';
import { Sheet } from '@/components/ui';
import type { Characterization } from '@/lib/academy/characterization';
import { COACHING_TYPES, MISSING_LABEL, type SetupMissing } from '@/lib/academy/trainee-setup';
import { CharacterizationForm } from './CharacterizationForm';
import { ZoneRows } from './ZoneRows';
import { formatPace } from '@/lib/garmin/pace';
import {
  BASELINE_DISTANCES, thresholdFromRace, validResult,
  type BaselineDistance, type BaselineSource, type SheetResults,
} from '@/lib/academy/coach-baseline';
import { typeClock } from '@/lib/time-entry';

// ═════════════════════════════════════════════════════════════════════════════
// "טופס התאמה" — the coach's half of a trainee's details (academy-onboarding/
// who-fills-what.html): the coaching type and the band, which are the coach's calls,
// and the characterization (goal, race, days, km, limitations, the coach's read) that the
// plan composer already reads. The trainee fills only what only they know. On the
// trainee's card, with what is still missing, until it is complete.
// ═════════════════════════════════════════════════════════════════════════════

interface Setup {
  name: string | null;
  coachingType: string | null;
  bandId: string | null;
  bands: Array<{ id: string; name: string; description?: string | null }>;
  candidateId: string | null;
  /** An approved 30-minute test exists: the baseline is not needed (and would lose to it). */
  tested?: boolean;
  baseline?: { date: string; thresholdSec: number; source: BaselineSource | null } | null;
  sheetResults?: SheetResults | null;
  suggestion?: { pick: BaselineDistance; sec: number; outliers: BaselineDistance[] } | null;
  fromTrainee: { medicalHistory: string | null; medicalDetails: string | null };
  missing: SetupMissing[];
}

/** The banner on the trainee's card; nothing for anybody who is not their coach. */
export function TraineeSetupBanner({ athleteId }: { athleteId: string }) {
  const { data, mutate } = useApi<Setup>(`/api/academy/trainee-setup?athleteId=${encodeURIComponent(athleteId)}`, { shouldRetryOnError: false });
  const [open, setOpen] = useState(false);
  // Opened from the coach's push ("אפשר כבר להשלים את טופס ההתאמה"): straight in.
  useEffect(() => {
    if (data && new URLSearchParams(window.location.search).get('setup') === '1') setOpen(true);
  }, [data]);
  if (!data || !Array.isArray(data.missing)) return null;
  const left = data.missing.length;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className={cn('flex w-full min-h-[60px] items-center gap-3 rounded-card px-4 py-3 text-start',
          left ? 'border border-[#FFE2A8] bg-[#FFF7E6]' : 'border border-page bg-card')}>
        <ClipboardList className={cn('h-5 w-5 shrink-0', left ? 'text-[#8A5A00]' : 'text-accent-600')} />
        <span className="min-w-0 flex-1">
          <b className={cn('block text-[14.5px]', left ? 'text-[#7A4E00]' : 'text-ink-900')}>
            {left ? `טופס התאמה — ${left === 1 ? 'פרט אחד חסר' : `${left} פרטים חסרים`}` : 'טופס התאמה ✓'}
          </b>
          <small className={cn('block truncate text-[12px]', left ? 'text-[#8A5A00]' : 'text-ink-400')}>
            {left ? data.missing.map((m) => MISSING_LABEL[m]).join(', ') : 'סוג ליווי, דבוקה, מטרה וימים — מולאו'}
          </small>
        </span>
        <span className="shrink-0 text-[13px] font-extrabold text-brand-600">{left ? 'להשלמה' : 'עריכה'}</span>
      </button>
      <TraineeSetupSheet open={open} onOpenChange={(o) => { setOpen(o); if (!o) void mutate(); }} athleteId={athleteId} setup={data} onSaved={() => void mutate()} />
    </>
  );
}

function TraineeSetupSheet({ open, onOpenChange, athleteId, setup, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; athleteId: string; setup: Setup; onSaved: () => void;
}) {
  const [coachingType, setCoachingType] = useState<string | null>(setup.coachingType);
  const [bandId, setBandId] = useState<string | null>(setup.bandId);
  const [err, setErr] = useState<string | null>(null);
  const [characterization, setCharacterization] = useState<Characterization | null | undefined>(undefined);
  useEffect(() => { if (open) { setCoachingType(setup.coachingType); setBandId(setup.bandId); setErr(null); } }, [open, setup.coachingType, setup.bandId]);
  useEffect(() => {
    if (!open || !setup.candidateId) return;
    let live = true;
    void (async () => {
      const res = await fetch(`/api/academy/characterization?candidateId=${encodeURIComponent(setup.candidateId!)}`, { headers: await apiHeaders() });
      const body = await res.json().catch(() => null);
      if (live) setCharacterization(res.ok ? (body?.characterization ?? null) : null);
    })();
    return () => { live = false; };
  }, [open, setup.candidateId]);

  const save = async (patch: { coachingType?: string | null; bandId?: string | null }) => {
    setErr(null);
    const res = await fetch('/api/academy/trainee-setup', { method: 'PUT', headers: await apiHeaders(true), body: JSON.stringify({ athleteId, ...patch }) });
    if (!res.ok) { setErr('לא נשמר — נסו שוב'); return; }
    onSaved();
  };

  const med = setup.fromTrainee;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={`טופס התאמה · ${setup.name || ''}`}>
      <div className="space-y-4 px-4 pb-6" dir="rtl">
        {(med.medicalHistory || med.medicalDetails) && (
          <div className="rounded-2xl bg-page px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-700">
            <b className="block text-[12px] text-ink-400">מה המתאמן כתב — בריאות</b>
            {[med.medicalHistory, med.medicalDetails].filter(Boolean).join(' · ')}
          </div>
        )}

        <section>
          <p className="mb-2 px-1 text-[15px] font-bold text-ink-900">סוג הליווי</p>
          <div className="space-y-1.5">
            {COACHING_TYPES.map((t) => (
              <button key={t} type="button" aria-pressed={coachingType === t}
                onClick={() => { setCoachingType(t); void save({ coachingType: t }); }}
                className={cn('flex w-full min-h-[48px] items-center gap-3 rounded-xl border-[1.5px] px-3 text-start text-[14px] font-semibold',
                  coachingType === t ? 'border-brand-600 bg-[#F4F5FF] text-ink-900' : 'border-[#E4E5EC] bg-card text-ink-700')}>
                <span className={cn('h-[18px] w-[18px] shrink-0 rounded-full border-2', coachingType === t ? 'border-[6px] border-brand-600' : 'border-ink-300')} />
                {t}
              </button>
            ))}
          </div>
        </section>

        <section>
          <p className="mb-2 px-1 text-[15px] font-bold text-ink-900">דבוקה</p>
          <div className="space-y-1.5">
            {setup.bands.map((b) => (
              <button key={b.id} type="button" aria-pressed={bandId === b.id}
                onClick={() => { setBandId(b.id); void save({ bandId: b.id }); }}
                className={cn('flex w-full min-h-[52px] items-center gap-3 rounded-xl border-[1.5px] px-3 py-1.5 text-start',
                  bandId === b.id ? 'border-brand-600 bg-[#F4F5FF]' : 'border-[#E4E5EC] bg-card')}>
                <span className={cn('h-[18px] w-[18px] shrink-0 rounded-full border-2', bandId === b.id ? 'border-[6px] border-brand-600' : 'border-ink-300')} />
                <span className="min-w-0">
                  <b className="block text-[14px] text-ink-900">{b.name}</b>
                  {b.description && <small className="block text-[12px] text-ink-500">{b.description}</small>}
                </span>
              </button>
            ))}
          </div>
        </section>
        {err && <p className="px-1 text-[13px] font-bold text-accent-red-ink" role="alert">{err}</p>}

        <BaselineSection athleteId={athleteId} setup={setup} onSaved={onSaved} />

        <section className="border-t border-page pt-3">
          <p className="mb-1 px-1 text-[15px] font-bold text-ink-900">מטרה, ימים, ק״מ ומגבלות</p>
          <p className="mb-2 px-1 text-[12px] text-ink-400">נשמר לבד. זה מה שבונה את השבוע הראשון.</p>
          {!setup.candidateId ? (
            <p className="px-1 text-[13px] text-ink-400">אין למתאמן כרטיס במשפך, אז אין איפה לשמור את האפיון.</p>
          ) : characterization === undefined ? (
            <p className="px-1 text-[13px] text-ink-400">טוען…</p>
          ) : (
            <CharacterizationForm
              candidateId={setup.candidateId}
              value={characterization}
              today={israelToday()}
              onSave={async (next) => {
                const res = await fetch('/api/academy/characterization', {
                  method: 'PUT', headers: await apiHeaders(true), body: JSON.stringify({ ...next, candidateId: setup.candidateId }),
                });
                if (!res.ok) return false;
                const body = await res.json().catch(() => null);
                if (body?.characterization) setCharacterization(body.characterization);
                onSaved();
                return true;
              }}
            />
          )}
        </section>
      </div>
    </Sheet>
  );
}

const clockOf = (sec: number) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = Math.round(sec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
};
/** "42:00", "1:32:00", "20" (minutes) → seconds; NaN when it is not a time. */
function parseClock(text: string): number {
  const parts = text.trim().split(':').map((p) => Number(p));
  if (!parts.length || parts.some((n) => !Number.isFinite(n) || n < 0)) return NaN;
  if (parts.length === 1) return parts[0] * 60;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return NaN;
}

/**
 * "בסיס קצב (במקום טסט)" (Ofer, 2026-10-20, mockups/coach-baseline): a distance and a result
 * — the finish time or the pace, the other fills in — and every zone follows from it, the
 * same as from a test (coach-baseline.ts). Prefilled from the academy file when the trainee
 * came with results, with a warning when they contradict each other. Required until the first
 * approved test, which replaces it.
 */
function BaselineSection({ athleteId, setup, onSaved }: { athleteId: string; setup: Setup; onSaved: () => void }) {
  const saved = setup.baseline?.source ?? null;
  const sheet = setup.sheetResults ?? null;
  const suggestion = setup.suggestion ?? null;
  const initial: BaselineDistance | 'other' = saved?.distance ?? suggestion?.pick ?? '10k';
  const initialSec = saved?.sec ?? (suggestion ? suggestion.sec : null);
  const [distance, setDistance] = useState<BaselineDistance | 'other'>(initial);
  const [otherKm, setOtherKm] = useState(saved?.distance === 'other' ? String(saved.km) : '');
  const [mode, setMode] = useState<'time' | 'pace'>('time');
  const [text, setText] = useState(initialSec ? clockOf(initialSec) : '');
  const [origin, setOrigin] = useState<BaselineSource['origin']>(saved?.origin ?? (suggestion ? 'sheet' : 'race'));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dirty, setDirty] = useState(!saved);

  if (setup.tested) {
    return (
      <section className="rounded-2xl border-[1.5px] border-page bg-card p-3.5">
        <p className="text-[15px] font-bold text-ink-900">קצבים</p>
        <p className="mb-2 mt-0.5 text-[12.5px] text-ink-500">יש טסט מאושר — הקצבים לפיו. אפשר לשנות כל אזור ב־✎.</p>
        <ZoneRows athleteId={athleteId} onSaved={onSaved} />
      </section>
    );
  }

  const km = distance === 'other' ? Number(otherKm) : BASELINE_DISTANCES[distance].km;
  const entered = parseClock(text);
  const sec = mode === 'time' ? entered : entered * km;
  const ok = validResult(km, sec);
  const thr = ok ? thresholdFromRace(km, sec) : null;
  const pick = (d: BaselineDistance | 'other') => {
    setDistance(d); setDirty(true);
    const fromSheet = d !== 'other' ? sheet?.[d] : undefined;
    if (fromSheet) { setMode('time'); setText(clockOf(fromSheet)); setOrigin('sheet'); }
  };
  const save = async () => {
    if (!ok) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/academy/trainee-setup', {
        method: 'PUT', headers: await apiHeaders(true),
        body: JSON.stringify({ athleteId, baseline: { distance, km, sec: Math.round(sec), origin } }),
      });
      if (!res.ok) { setErr('לא נשמר — נסו שוב'); return; }
      setDirty(false);
      onSaved();
    } catch {
      setErr('לא נשמר — נסו שוב');
    } finally {
      setBusy(false);
    }
  };
  const chip = (on: boolean) => cn('min-h-[40px] shrink-0 whitespace-nowrap rounded-pill px-3 text-[13.5px] font-bold', on ? 'bg-brand-600 text-white' : 'bg-white text-ink-700');

  return (
    <section className="rounded-2xl border-[1.5px] border-brand-600/20 bg-[#F7F8FF] p-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[15px] font-bold text-ink-900">בסיס קצב <span className="font-semibold text-ink-400">(במקום טסט)</span></p>
        <span className="shrink-0 rounded-pill bg-white px-2 py-0.5 text-[11.5px] font-extrabold text-brand-600">המאמן קובע</span>
      </div>
      <p className="mb-2.5 mt-0.5 text-[12.5px] text-ink-500">מרחק ותוצאה שהמתאמן רץ לאחרונה — ומהם כל הקצבים, כמו מטסט.</p>

      {sheet && (
        <div className="mb-2.5 rounded-xl bg-white px-3 py-2 text-[12.5px] text-ink-700">
          <b className="block text-[11.5px] text-ink-400">מהקובץ של האקדמיה · לבחירה</b>
          <span className="flex flex-wrap gap-x-3 gap-y-0.5">
            {(Object.keys(BASELINE_DISTANCES) as BaselineDistance[]).filter((d) => sheet[d]).map((d) => (
              <button key={d} type="button" onClick={() => pick(d)} className={cn('min-h-[32px]', d === distance && 'font-extrabold text-brand-600')}>
                {BASELINE_DISTANCES[d].label} <bdi dir="ltr">{clockOf(sheet[d]!)}</bdi>
              </button>
            ))}
          </span>
        </div>
      )}
      {suggestion && suggestion.outliers.length > 0 && (
        <p className="mb-2.5 rounded-xl bg-[#FDF0E2] px-3 py-2 text-[12.5px] font-bold leading-snug text-[#8A4308]">
          {suggestion.outliers.map((d) => BASELINE_DISTANCES[d].label).join(', ')} בקובץ לא מתאים לשאר התוצאות — כנראה ישן. הצענו לפי {BASELINE_DISTANCES[suggestion.pick].label}.
        </p>
      )}

      <div className="-mx-1 mb-2.5 flex gap-1.5 overflow-x-auto px-1 [scrollbar-width:none]">
        {(Object.keys(BASELINE_DISTANCES) as BaselineDistance[]).map((d) => (
          <button key={d} type="button" aria-pressed={distance === d} onClick={() => pick(d)} className={chip(distance === d)}>{BASELINE_DISTANCES[d].label}</button>
        ))}
        <button type="button" aria-pressed={distance === 'other'} onClick={() => pick('other')} className={chip(distance === 'other')}>אחר…</button>
      </div>
      {distance === 'other' && (
        <label className="mb-2 flex items-center gap-2 rounded-xl border-[1.5px] border-[#E4E5EC] bg-white px-3 py-2">
          <span className="text-[12.5px] font-bold text-ink-400">ק״מ</span>
          <input value={otherKm} onChange={(e) => { setOtherKm(e.target.value); setDirty(true); }} inputMode="decimal" dir="ltr" aria-label="מרחק בק״מ"
            className="min-w-0 flex-1 bg-transparent text-[18px] font-black text-ink-900 focus:outline-none" />
        </label>
      )}
      <div className="grid grid-cols-2 gap-2">
        {(['time', 'pace'] as const).map((m) => {
          const shown = m === mode ? text : ok ? (m === 'time' ? clockOf(sec) : formatPace(sec / km)) : '';
          return (
            <label key={m} className={cn('rounded-xl border-[1.5px] bg-white px-3 py-2', mode === m ? 'border-brand-600' : 'border-[#E4E5EC]')}>
              <span className="block text-[11.5px] font-bold text-ink-400">{m === 'time' ? 'זמן סיום' : 'קצב לק״מ'}</span>
              <input value={shown} dir="ltr" inputMode="numeric" aria-label={m === 'time' ? 'זמן סיום' : 'קצב לק״מ'}
                onFocus={() => { if (mode !== m) { setMode(m); setText(shown); } }}
                onChange={(e) => { setMode(m); setText(typeClock(e.target.value, m === 'time' ? 6 : 4)); setDirty(true); if (origin === 'sheet') setOrigin('race'); }}
                className="w-full bg-transparent text-[20px] font-black tabular-nums text-ink-900 focus:outline-none" />
            </label>
          );
        })}
      </div>
      <p className="mt-1.5 px-0.5 text-[11.5px] text-ink-400">ממלאים אחד — השני מתמלא לבד</p>
      <div className="mb-2.5 mt-1.5 flex gap-1.5" role="group" aria-label="מאיפה התוצאה">
        {(['sheet', 'race', 'estimate'] as const).filter((o) => o !== 'sheet' || !!sheet).map((o) => (
          <button key={o} type="button" aria-pressed={origin === o} onClick={() => { setOrigin(o); setDirty(true); }}
            className={cn('min-h-[36px] rounded-pill px-3 text-[12.5px] font-bold', origin === o ? 'bg-brand-600/10 text-brand-600' : 'bg-white text-ink-400')}>
            {o === 'sheet' ? 'מהקובץ' : o === 'race' ? 'תוצאה' : 'הערכה'}
          </button>
        ))}
      </div>

      <p className="mb-1.5 text-[13px] font-bold text-ink-700">הקצבים המוצעים · ✎ למי שרוצה לשנות</p>
      {dirty || !saved
        ? <ZoneRows athleteId={athleteId} previewThresholdSec={thr} />
        : <ZoneRows athleteId={athleteId} onSaved={onSaved} />}
      <p className="mt-2.5 rounded-xl bg-white px-3 py-2 text-[12.5px] leading-snug text-ink-500">נקבע על ידי המאמן — עד הטסט הראשון. טסט שמאושר מחליף אותו לבד.</p>
      {err && <p className="mt-2 text-[13px] font-bold text-accent-red-ink" role="alert">{err}</p>}
      {(dirty || !saved) && (
        <button type="button" disabled={!ok || busy} onClick={() => void save()}
          className="mt-3 flex min-h-[50px] w-full items-center justify-center rounded-2xl bg-brand-600 text-[15.5px] font-extrabold text-white disabled:opacity-50">
          {busy ? 'שומר…' : `לשמור כבסיס הקצב של ${(setup.name || '').split(' ')[0]}`}
        </button>
      )}
    </section>
  );
}
