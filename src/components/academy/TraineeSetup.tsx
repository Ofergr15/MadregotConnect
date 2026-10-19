'use client';

import { useEffect, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { apiHeaders, useApi } from '@/lib/api';
import { cn, israelToday } from '@/lib/utils';
import { Sheet } from '@/components/ui';
import type { Characterization } from '@/lib/academy/characterization';
import { COACHING_TYPES, MISSING_LABEL, type SetupMissing } from '@/lib/academy/trainee-setup';
import { CharacterizationForm } from './CharacterizationForm';

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
  bands: Array<{ id: string; name: string }>;
  candidateId: string | null;
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
          <div className="flex flex-wrap gap-1.5">
            {setup.bands.map((b) => (
              <button key={b.id} type="button" aria-pressed={bandId === b.id}
                onClick={() => { setBandId(b.id); void save({ bandId: b.id }); }}
                className={cn('min-h-[44px] rounded-pill px-3.5 text-[13.5px] font-bold', bandId === b.id ? 'bg-brand-600 text-white' : 'bg-page text-ink-700')}>
                {b.name}
              </button>
            ))}
          </div>
        </section>
        {err && <p className="px-1 text-[13px] font-bold text-accent-red-ink" role="alert">{err}</p>}

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
