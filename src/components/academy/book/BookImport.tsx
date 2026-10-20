'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { KIND_REQUIRED_TEXT, kindHint, missingKinds, type KindChoice } from '@/lib/academy/kind-choice';
import { LIBRARY_KINDS } from '@/lib/academy/library';
import { importTickedByDefault } from '@/lib/academy/book-import';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { apiHeaders } from '@/lib/api';
import { cn } from '@/lib/utils';
import { fromLibrarySteps, profileBar } from '@/lib/academy/book-steps';
import type { ImportCandidate, ImportStatus } from '@/lib/academy/book-import';
import { BarButton, CARD, FlowOverlay, FlowScreen, N, PrimaryButton, ProfileBar, RICH } from './ui';

// ── "כל האימונים שכבר באפליקציה ייובאו לכאן" — the review before the import ─────────────
//
// The manager's button. The server scans every plan, converts and dedupes
// (lib/academy/book-import.ts) and returns a list; NOTHING is written until this screen's
// button is pressed, and then only the rows that are ticked. New sessions start ticked,
// the ones that need a look start unticked with the reason on the row, and the ones the
// book already has are listed (so the count adds up) but cannot be ticked.

type Row = Omit<ImportCandidate, 'sources'> & { sources: Array<{ weekStart: string; dayOfWeek: number; origin: 'club' | 'academy' }> };

interface ImportResponse {
  candidates: Row[];
  summary?: Record<ImportStatus, number>;
  plansScanned?: number;
  tableMissing?: boolean;
}

export function BookImport({ onClose, onImported }: { onClose: () => void; onImported?: () => void }) {
  const t = useTranslations('workoutBook');
  const [data, setData] = useState<ImportResponse | null>(null);
  const [error, setError] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // The type of each row, chosen by the manager — none to begin with (kind-choice.ts).
  const [kinds, setKinds] = useState<Record<string, KindChoice>>({});
  const [busy, setBusy] = useState(false);
  const [written, setWritten] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/academy/library/import', { headers: await apiHeaders() });
        const body = (await res.json()) as ImportResponse;
        if (cancelled) return;
        if (!res.ok) { setError(true); return; }
        setData(body);
        setPicked(new Set(body.candidates.filter(c => importTickedByDefault(c)).map(c => c.key)));
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const rows = useMemo(() => data?.candidates ?? [], [data]);
  const summary = data?.summary ?? { new: 0, existing: 0, review: 0 };

  const save = async () => {
    setBusy(true);
    setSaveError(null);
    try {
      const res = await fetch('/api/academy/library/import', {
        method: 'POST',
        headers: await apiHeaders(true),
        body: JSON.stringify({ keys: [...picked], kinds }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setSaveError(res.status === 409 ? t('import.nameTaken') : t('import.failed')); return; }
      setWritten(Number(body.written || 0));
      onImported?.();
    } catch {
      setSaveError(t('import.failed'));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (row: Row) => {
    if (!row.saveable || written !== null) return;
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(row.key)) next.delete(row.key); else next.add(row.key);
      return next;
    });
  };

  const missing = useMemo(() => missingKinds(picked, kinds), [picked, kinds]);

  const ordered = useMemo(() => {
    const rank: Record<ImportStatus, number> = { new: 0, review: 1, existing: 2 };
    return [...rows].sort((a, b) => rank[a.status] - rank[b.status] || b.uses - a.uses);
  }, [rows]);

  return (
    <FlowOverlay label={t('import.title')}>
      <FlowScreen
        title={t('import.title')}
        leading={<BarButton onClick={onClose}>{written !== null ? t('close') : t('cancel')}</BarButton>}
        footer={written !== null
          ? <PrimaryButton onClick={onClose}>{t.rich('import.written', { ...RICH, n: written })}</PrimaryButton>
          : (
            <>
              {missing.length > 0 && <p className="text-center text-[13px] font-bold text-[#8A4308]">{KIND_REQUIRED_TEXT} · <N>{missing.length}</N></p>}
              <PrimaryButton onClick={() => void save()} disabled={!picked.size || missing.length > 0} busy={busy}>{t('import.save', { n: picked.size })}</PrimaryButton>
            </>
          )}
      >
        {error && <p className="py-6 text-center text-sm text-accent-red-ink">{t('import.loadFailed')}</p>}
        {!data && !error && <p className="py-6 text-center text-sm text-ink-400">{t('import.scanning')}</p>}
        {data?.tableMissing && <p className="py-6 text-center text-sm text-ink-400">{t('bookNotSetUp')}</p>}
        {data && !data.tableMissing && (
          <>
            <p className="px-1 text-sm text-ink-500">{t.rich('import.scanned', { ...RICH, plans: data.plansScanned ?? 0, sessions: rows.length })}</p>
            <div className="grid grid-cols-3 gap-2">
              {(['new', 'existing', 'review'] as const).map(s => (
                <div key={s} className={cn(CARD, 'rounded-2xl px-3 py-2.5')}>
                  <small className="block text-xs font-bold text-ink-400">{t(`import.status.${s}`)}</small>
                  <N className="text-[19px] font-black text-ink-900">{summary[s]}</N>
                </div>
              ))}
            </div>
            {saveError && <p className="text-center text-sm font-bold text-accent-red-ink">{saveError}</p>}
            <div className={CARD}>
              {ordered.map(row => {
                const model = row.steps ? fromLibrarySteps(row.steps) : null;
                const on = picked.has(row.key);
                return (
                  <Fragment key={row.key}>
                  <div
                    role={row.saveable ? 'checkbox' : undefined}
                    aria-checked={row.saveable ? on : undefined}
                    tabIndex={row.saveable ? 0 : -1}
                    onClick={() => toggle(row)}
                    onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(row); } }}
                    className={cn('flex min-h-[64px] items-center gap-3 border-b border-[#EFEFF4] px-4 py-3 last:border-0', row.saveable ? 'cursor-pointer' : 'opacity-80')}
                  >
                    <span className={cn(
                      'grid h-[26px] w-[26px] shrink-0 place-items-center rounded-lg border-2 text-white',
                      on ? 'border-brand-600 bg-brand-600' : row.saveable ? 'border-ink-300' : 'border-transparent bg-[#F4F4F8]',
                    )}>
                      {on && <Check className="h-4 w-4" strokeWidth={3.5} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-[16px] font-extrabold text-ink-900"><bdi>{row.name}</bdi></b>
                      <small className="mt-0.5 block text-13 text-ink-400">
                        <span className={cn('font-bold', row.status === 'new' ? 'text-[#0E7A3C]' : row.status === 'review' ? 'text-[#8A4308]' : 'text-ink-500')}>
                          {t(`import.status.${row.status}`)}
                        </span>
                        {' · '}{t.rich('uses', { ...RICH, count: row.uses })}
                        {row.reasons.length > 0 && <> · {row.reasons.map(r => t(`import.reason.${r}`)).join(', ')}</>}
                      </small>
                    </span>
                    {model && <ProfileBar segments={profileBar(model, null)} size="sm" />}
                  </div>
                  {on && (
                    <div className="border-b border-[#EFEFF4] px-4 pb-3" onClick={e => e.stopPropagation()}>
                      {kindHint(row.kind, kinds[row.key] ?? null) && (
                        <button type="button" onClick={() => setKinds(k => ({ ...k, [row.key]: row.kind }))} className="min-h-[36px] text-[13px] font-bold text-brand-600">
                          נראה כמו: {t(`chip.${row.kind}`)} — לבחור
                        </button>
                      )}
                      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1">
                        {LIBRARY_KINDS.map(k => (
                          <button key={k} type="button" aria-pressed={kinds[row.key] === k} onClick={() => setKinds(m => ({ ...m, [row.key]: k }))}
                            className={cn('h-10 shrink-0 whitespace-nowrap rounded-full px-3.5 text-[14px] font-bold', kinds[row.key] === k ? 'bg-ink-900 text-white' : 'bg-[#F4F4F8] text-ink-500')}>
                            {t(`chip.${k}`)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  </Fragment>
                );
              })}
            </div>
          </>
        )}
      </FlowScreen>
    </FlowOverlay>
  );
}
