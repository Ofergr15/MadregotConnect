'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, ChevronDown, Target } from 'lucide-react';
import { cn } from '@/lib/utils';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { Spinner } from '@/components/ui';
import {
  MAX_PACE_OFFSET_SEC, MIN_PACE_OFFSET_SEC, fmtOffsetSec, sortBands, type AcademyBand,
} from '@/lib/academy/bands';

// The academy's goal bands and the paces each one runs — the one setting that
// everything else in the academy is measured against.
//
// It lives on the manager's overview rather than in a settings screen because it
// is not a preference: migration 077 seeds the six bands with NO offset at all
// (guessing the spread between a sub-3 marathoner and a beginner would have put
// invented paces on real watches), so until someone fills these in the planner
// cannot re-pace anybody. That's a task, and tasks belong where the manager
// already looks.
//
// Collapsed to a single row when every band is set, because then it's just a fact
// to check. Wearing a warning when some are missing, because then it's work.

/** Quick offsets, in sec/km — the values a coach reaches for, not a scale. */
const OFFSET_PRESETS = [0, 15, 30, 45, 60, 90, 120];

export function BandPaces({
  bands,
  canEdit,
  onChanged,
}: {
  bands: AcademyBand[];
  /** Manager-only. A coach sees the paces but doesn't move a whole band. */
  canEdit: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const t = useTranslations('academy');
  const ordered = sortBands(bands);
  const unpriced = ordered.filter((b) => typeof b.paceProfile?.offsetSeconds !== 'number');

  const [open, setOpen] = useState(unpriced.length > 0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (ordered.length === 0) return null;

  const startEdit = (band: AcademyBand) => {
    setError(null);
    setEditingId(band.id);
    const current = band.paceProfile?.offsetSeconds;
    setInput(typeof current === 'number' ? String(current) : '');
  };

  const save = async (bandId: string, offsetSeconds: number | null) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/academy/bands', {
        method: 'PATCH',
        headers: await bearerHeaders(),
        body: JSON.stringify({ bandId, offsetSeconds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || t('pairingError')); return; }
      setEditingId(null);
      await onChanged();
    } catch {
      setError(t('pairingError'));
    } finally {
      setBusy(false);
    }
  };

  const commit = (bandId: string) => {
    const parsed = Number(input.trim());
    if (!input.trim() || !Number.isInteger(parsed)
      || parsed < MIN_PACE_OFFSET_SEC || parsed > MAX_PACE_OFFSET_SEC) {
      setError(t('paceOutOfRange', { min: MIN_PACE_OFFSET_SEC, max: MAX_PACE_OFFSET_SEC }));
      return;
    }
    save(bandId, parsed);
  };

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'w-full flex items-center gap-3 rounded-2xl border px-3.5 py-3 text-start transition-all active:scale-[0.99] min-h-[44px]',
          unpriced.length > 0
            ? 'border-band-3/30 bg-band-3/10 hover:bg-band-3/15'
            : 'border-page/60 bg-card/60 hover:bg-page/90',
        )}
      >
        <span className={cn(
          'w-9 h-9 rounded-xl flex items-center justify-center shrink-0',
          unpriced.length > 0 ? 'bg-band-3/20' : 'bg-accent-600/15',
        )}>
          {unpriced.length > 0
            ? <AlertTriangle className="h-4 w-4 text-band-3" />
            : <Target className="h-4 w-4 text-accent-600" />}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-bold text-ink-700">{t('bandPacesHeader')}</span>
          <span className={cn('block text-xs truncate', unpriced.length > 0 ? 'text-band-3/80' : 'text-ink-400')}>
            {unpriced.length > 0
              ? t('bandPacesMissing', { count: unpriced.length })
              : t('bandPacesAllSet', { count: ordered.length })}
          </span>
        </span>
        <ChevronDown className={cn('h-4 w-4 text-ink-400 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="mt-2 rounded-card bg-card/50 border border-page/50 divide-y divide-page/50 overflow-hidden">
          {ordered.map((b) => {
            const offset = b.paceProfile?.offsetSeconds;
            const editing = editingId === b.id;
            return (
              <div key={b.id} className="px-3.5 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-ink-700 truncate">{b.name}</div>
                    {b.goal && <div className="text-xs text-ink-400 truncate">{b.goal}</div>}
                  </div>
                  <div className="text-end shrink-0">
                    <div className={cn(
                      'text-sm font-bold tabular-nums',
                      typeof offset === 'number' ? 'text-ink-700' : 'text-band-3',
                    )}>
                      {typeof offset === 'number' ? fmtOffsetSec(offset) : '—'}
                    </div>
                    <div className="text-3xs text-ink-400 -mt-0.5">
                      {t('traineesShort', { count: b.trainees ?? 0 })}
                    </div>
                  </div>
                  {canEdit && !editing && (
                    <button
                      onClick={() => startEdit(b)}
                      className="text-xs font-semibold text-brand-600 hover:text-brand-700 shrink-0 min-h-[32px] px-1"
                    >
                      {typeof offset === 'number' ? t('edit') : t('setPace')}
                    </button>
                  )}
                </div>

                {editing && (
                  <div className="mt-3 space-y-2.5">
                    <div className="flex gap-1">
                      {OFFSET_PRESETS.map((o) => (
                        <button
                          key={o}
                          onClick={() => setInput(String(o))}
                          className={cn(
                            'flex-1 rounded-lg py-2 text-xs font-bold tabular-nums transition-colors min-h-[40px]',
                            input === String(o)
                              ? 'bg-brand-600 text-white'
                              : 'bg-page/60 text-ink-400 hover:text-ink-900',
                          )}
                        >
                          {fmtOffsetSec(o)}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        inputMode="numeric"
                        dir="ltr"
                        step={1}
                        min={MIN_PACE_OFFSET_SEC}
                        max={MAX_PACE_OFFSET_SEC}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        className="w-24 rounded-xl bg-page border border-page px-3 min-h-[44px] text-sm text-ink-700 tabular-nums text-center focus:outline-none focus:border-brand-600"
                      />
                      <span className="text-xs text-ink-400">{t('secPerKmUnit')}</span>
                    </div>
                    <p className="text-2xs text-ink-400">{t('bandOffsetHelp', { count: b.trainees ?? 0 })}</p>
                    {error && <p className="text-xs text-accent-red">{error}</p>}
                    <div className="flex gap-2">
                      <button
                        onClick={() => commit(b.id)}
                        disabled={busy}
                        className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 min-h-[44px] disabled:opacity-60"
                      >
                        {busy && <Spinner size={14} />}
                        {busy ? t('saving') : t('save')}
                      </button>
                      {/* Clearing is reachable on purpose: a wrong offset silently
                          mis-paces everyone in the band, and "not set" is a more
                          honest state than a stale guess. */}
                      {typeof offset === 'number' && (
                        <button
                          onClick={() => save(b.id, null)}
                          disabled={busy}
                          className="rounded-xl bg-page px-3 py-2.5 text-xs font-semibold text-ink-700 hover:bg-ink-300/40 min-h-[44px] disabled:opacity-60"
                        >
                          {t('unsetPace')}
                        </button>
                      )}
                      <button
                        onClick={() => { setEditingId(null); setError(null); }}
                        disabled={busy}
                        className="rounded-xl bg-page px-3 py-2.5 text-xs font-semibold text-ink-700 hover:bg-ink-300/40 min-h-[44px] disabled:opacity-60"
                      >
                        {t('cancel')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
