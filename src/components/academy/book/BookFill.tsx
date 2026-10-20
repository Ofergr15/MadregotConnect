'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiHeaders } from '@/lib/api';
import { cn } from '@/lib/utils';
import { LIBRARY_KINDS, isUnclassified, type LibraryEntry, type LibraryKind } from '@/lib/academy/library';
import { KIND_REQUIRED_TEXT } from '@/lib/academy/kind-choice';
import { ESTIMATE_THRESHOLD_SEC, bookTotals, fromLibrarySteps, profileBar } from '@/lib/academy/book-steps';
import { BarButton, CARD, FlowOverlay, FlowScreen, N, PrimaryButton, ProfileBar, RICH, clockText, kmText } from './ui';

// ── "למלא את הספר מכל ההיסטוריה" and "סיווג" (Ofer, 2026-10-20) ───────────────────────────
//
// The fill: one button that writes every session the history holds (the club's weeks, the
// one-day sessions, the legacy templates) and the book does not — each one UNCLASSIFIED, its
// type only the import's guess. The classify screen then turns guesses into choices, one
// entry per screen with its drawing and size, so a manager gets through a hundred in minutes.

interface FillPreview {
  toAdd: number;
  alreadyIn: number;
  ready: boolean;
  sources: { club: number; academy: number; day: number; template: number };
}

export function BookFill({ onClose, onFilled }: { onClose: () => void; onFilled?: () => void }) {
  const t = useTranslations('workoutBook');
  const [preview, setPreview] = useState<FillPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [written, setWritten] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/academy/library/import', { headers: await apiHeaders() });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || !body.fill) { setError(t('fill.loadFailed')); return; }
        setPreview(body.fill as FillPreview);
      } catch {
        if (!cancelled) setError(t('fill.loadFailed'));
      }
    })();
    return () => { cancelled = true; };
  }, [t]);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/academy/library/import', {
        method: 'POST',
        headers: await apiHeaders(true),
        body: JSON.stringify({ action: 'fill' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body?.needsMigration ? t('fill.needsMigration') : t('fill.failed')); return; }
      setWritten(Number(body.written || 0));
      onFilled?.();
    } catch {
      setError(t('fill.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FlowOverlay label={t('fill.title')}>
      <FlowScreen
        title={t('fill.title')}
        leading={<BarButton onClick={onClose}>{written !== null ? t('close') : t('cancel')}</BarButton>}
        footer={written !== null
          ? <PrimaryButton onClick={onClose}>{t.rich('fill.written', { ...RICH, n: written })}</PrimaryButton>
          : <PrimaryButton onClick={() => void run()} disabled={!preview || !preview.ready || preview.toAdd === 0} busy={busy}>
              {preview && preview.toAdd === 0 ? t('fill.nothing') : t('fill.go', { n: preview?.toAdd ?? 0 })}
            </PrimaryButton>}
      >
        {!preview && !error && <p className="py-6 text-center text-sm text-ink-400">{t('import.scanning')}</p>}
        {error && <p className="py-4 text-center text-sm font-bold text-accent-red-ink">{error}</p>}
        {preview && (
          <>
            <div className={cn(CARD, 'px-4 py-4')}>
              <p className="text-[15px] leading-relaxed text-ink-700">{t('fill.lead')}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Stat label={t('fill.toAdd')} value={preview.toAdd} strong />
                <Stat label={t('fill.alreadyIn')} value={preview.alreadyIn} />
              </div>
              <p className="mt-3 text-13 text-ink-400">
                {t.rich('fill.sources', { ...RICH, weeks: preview.sources.club + preview.sources.academy, days: preview.sources.day, templates: preview.sources.template })}
              </p>
            </div>
            <div className={cn(CARD, 'px-4 py-3.5 text-[14px] leading-relaxed text-ink-500')}>
              {t('fill.unclassified')}
            </div>
            {!preview.ready && <p className="px-1 text-center text-sm font-bold text-[#8A4308]">{t('fill.needsMigration')}</p>}
          </>
        )}
      </FlowScreen>
    </FlowOverlay>
  );
}

function Stat({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="rounded-2xl bg-[#F4F4F8] px-3 py-2.5">
      <small className="block text-xs font-bold text-ink-400">{label}</small>
      <N className={cn('text-[22px] font-black', strong ? 'text-brand-600' : 'text-ink-900')}>{value}</N>
    </div>
  );
}

/** The entries still waiting for a type, most-used first. */
export function unclassifiedOf(entries: LibraryEntry[]): LibraryEntry[] {
  return entries.filter(isUnclassified).sort((a, b) => b.useCount - a.useCount || a.name.localeCompare(b.name));
}

/**
 * One entry per screen: its drawing, its size at a typical pace, the guess as a hint, the six
 * types. Choosing a type saves it and moves on; "דילוג" leaves it for later.
 */
export function BookClassify({ entries, onClose, onClassified }: {
  entries: LibraryEntry[];
  onClose: () => void;
  onClassified: (entry: LibraryEntry) => void;
}) {
  const t = useTranslations('workoutBook');
  // The queue is fixed when the screen opens, so a skipped entry stays skipped this round.
  const [queue] = useState(() => unclassifiedOf(entries).map(e => e.id));
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(0);
  const byId = useMemo(() => new Map(entries.map(e => [e.id, e])), [entries]);
  const entry = at < queue.length ? byId.get(queue[at]) ?? null : null;
  const left = Math.max(queue.length - at, 0);

  const model = useMemo(() => (entry ? fromLibrarySteps(entry.steps) : null), [entry]);
  const size = useMemo(() => (model ? bookTotals(model, ESTIMATE_THRESHOLD_SEC) : null), [model]);

  const choose = async (kind: LibraryKind) => {
    if (!entry || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/academy/library', {
        method: 'PATCH',
        headers: await apiHeaders(true),
        body: JSON.stringify({ id: entry.id, action: 'classify', kind }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body?.needsMigration ? t('fill.needsMigration') : t('classify.failed')); return; }
      onClassified(body.entry as LibraryEntry);
      setDone(n => n + 1);
      setAt(i => i + 1);
    } catch {
      setError(t('classify.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FlowOverlay label={t('classify.title')}>
      <FlowScreen
        title={t('classify.title')}
        leading={<BarButton onClick={onClose}>{t('close')}</BarButton>}
        trailing={entry ? <span className="text-13 font-bold text-ink-400">{t.rich('classify.left', { ...RICH, n: left })}</span> : undefined}
        footer={entry
          ? <PrimaryButton secondary onClick={() => setAt(i => i + 1)} disabled={busy}>{t('classify.skip')}</PrimaryButton>
          : <PrimaryButton onClick={onClose}>{t.rich('classify.allDone', { ...RICH, n: done })}</PrimaryButton>}
      >
        {!entry && (
          <div className={cn(CARD, 'px-5 py-8 text-center')}>
            <p className="text-[19px] font-black text-ink-900">{queue.length ? t('classify.doneTitle') : t('classify.emptyTitle')}</p>
            <p className="mt-1 text-sm text-ink-500">{t.rich('classify.doneBody', { ...RICH, n: done })}</p>
          </div>
        )}
        {entry && (
          <>
            <div className={cn(CARD, 'px-4 py-4')}>
              <h3 className="text-[22px] font-black leading-snug text-ink-900"><bdi>{entry.name}</bdi></h3>
              {size && (size.distanceM > 0 || size.durationSec > 0) && (
                <p className="mt-1 text-sm text-ink-500">
                  {size.distanceM > 0 && <><N className="font-bold text-ink-900">{kmText(size.distanceM)}</N> ק״מ</>}
                  {size.distanceM > 0 && size.durationSec > 0 && ' · '}
                  {size.durationSec > 0 && <><N className="font-bold text-ink-900">{clockText(size.durationSec)}</N></>}
                  {' · '}{t('classify.typicalPace')}
                </p>
              )}
              <p className="mt-0.5 text-13 text-ink-400">{t.rich('uses', { ...RICH, count: entry.useCount })}</p>
              {model && <div className="mt-3"><ProfileBar segments={profileBar(model, null)} size="md" /></div>}
            </div>
            <div className={cn(CARD, 'px-4 py-4')}>
              <p className="text-[15px] font-extrabold text-ink-900">{t('classify.question')}</p>
              <p className="mt-0.5 text-13 font-bold text-ink-400">{t('classify.hint', { kind: t(`chip.${entry.kind}`) })}</p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {LIBRARY_KINDS.map(k => (
                  <button
                    key={k}
                    type="button"
                    disabled={busy}
                    onClick={() => void choose(k)}
                    // No chip looks chosen: the guess is the hint line above, never a selection.
                    className="min-h-[52px] rounded-2xl bg-[#F4F4F8] text-[15px] font-extrabold text-ink-700 transition active:bg-ink-900 active:text-white"
                  >
                    {t(`chip.${k}`)}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-ink-400">{KIND_REQUIRED_TEXT} — {t('classify.oneTap')}</p>
              {error && <p className="mt-2 text-center text-sm font-bold text-accent-red-ink">{error}</p>}
            </div>
          </>
        )}
      </FlowScreen>
    </FlowOverlay>
  );
}
