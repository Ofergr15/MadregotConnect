'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiHeaders } from '@/lib/api';
import { cn } from '@/lib/utils';
import { LIBRARY_KINDS, isUnclassified, type LibraryEntry, type LibraryKind } from '@/lib/academy/library';
import { KIND_REQUIRED_TEXT } from '@/lib/academy/kind-choice';
import { ESTIMATE_THRESHOLD_SEC, bookTotals, fromLibrarySteps, profileBar } from '@/lib/academy/book-steps';
import { classifyWorkout, type Classified } from '@/lib/academy/book-classify';
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

const KIND_STYLE: Record<LibraryKind, { emoji: string; cls: string }> = {
  easy: { emoji: '🌿', cls: 'bg-[#E6F7EC] text-[#15803d]' },
  intervals: { emoji: '⚡', cls: 'bg-[#FFE8EC] text-[#C8102E]' },
  tempo: { emoji: '🔥', cls: 'bg-[#FFF1DE] text-[#B45309]' },
  long: { emoji: '🏞', cls: 'bg-[#EDE7FF] text-[#5b21b6]' },
  hills: { emoji: '⛰', cls: 'bg-[#E7F4FF] text-[#0369a1]' },
  test: { emoji: '⏱', cls: 'bg-[#f2f2f7] text-ink-900' },
};

/**
 * "זיהיתי לבד" (mockup ~/.cache/madregot/book-classify, Ofer 10-23): every unclassified
 * entry, its type DETECTED from the session's shape (lib/academy/book-classify) — grouped,
 * so a whole group is one tap ("לאשר את כולם"), or opened one by one: the drawing, the
 * size, the detected type with why, "✓ נכון" or another type.
 */
export function BookClassify({ entries, onClose, onClassified }: {
  entries: LibraryEntry[];
  onClose: () => void;
  onClassified: (entry: LibraryEntry) => void;
}) {
  const t = useTranslations('workoutBook');
  const [queue] = useState(() => unclassifiedOf(entries).map(e => e.id));
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byId = useMemo(() => new Map(entries.map(e => [e.id, e])), [entries]);
  const detected = useMemo(() => new Map(queue.map((id) => {
    const e = byId.get(id)!;
    return [id, classifyWorkout(fromLibrarySteps(e.steps), e.name)] as const;
  })), [queue, byId]);
  const left = queue.filter((id) => !doneIds.has(id));
  const groups = LIBRARY_KINDS.map((k) => [k, left.filter((id) => detected.get(id)?.kind === k)] as const).filter(([, ids]) => ids.length);

  const save = async (items: Array<{ id: string; kind: LibraryKind }>) => {
    if (!items.length || busy) return false;
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/academy/library/classify', { method: 'POST', headers: await apiHeaders(true), body: JSON.stringify({ items }) });
      if (!res.ok) { setError(t('classify.failed')); return false; }
      for (const it of items) { const e = byId.get(it.id); if (e) onClassified({ ...e, kind: it.kind, kindConfirmed: true }); }
      setDoneIds((d) => new Set([...d, ...items.map((x) => x.id)]));
      return true;
    } catch { setError(t('classify.failed')); return false; } finally { setBusy(false); }
  };
  // One by one: after a choice, straight on to the next one still waiting.
  const choose = async (id: string, kind: LibraryKind) => {
    if (await save([{ id, kind }])) setOpenId(left.find((x) => x !== id) ?? null);
  };

  const open = openId ? byId.get(openId) ?? null : null;
  return (
    <FlowOverlay label={t('classify.title')}>
      {open ? (
        <OneEntry entry={open} guess={detected.get(open.id)!} busy={busy} error={error}
          position={queue.length - left.length + 1} total={queue.length}
          onBack={() => setOpenId(null)} onChoose={(k) => void choose(open.id, k)} onSkip={() => setOpenId(left.find((x) => x !== open.id && left.indexOf(x) > left.indexOf(open.id)) ?? null)} />
      ) : (
        <FlowScreen
          title="זיהיתי לבד"
          leading={<BarButton onClick={onClose}>{t('close')}</BarButton>}
          trailing={<span className="text-13 font-bold text-ink-400">{left.length} לאישור</span>}
          footer={left.length ? undefined : <PrimaryButton onClick={onClose}>סיום</PrimaryButton>}
        >
          {!left.length && (
            <div className={cn(CARD, 'px-5 py-8 text-center')}>
              <p className="text-[19px] font-black text-ink-900">{queue.length ? 'הכל מסווג ✓' : t('classify.emptyTitle')}</p>
              {queue.length > 0 && <p className="mt-1 text-sm text-ink-500">{doneIds.size} אימונים קיבלו סוג</p>}
            </div>
          )}
          {left.length > 0 && <p className="px-1 pb-2 text-13 text-ink-500">לפי המבנה והעצימות של כל אימון. לאשר קבוצה בבת אחת, או לפתוח אחד ולשנות.</p>}
          {error && <p className="pb-2 text-center text-sm font-bold text-accent-red-ink">{error}</p>}
          <div className="space-y-2.5">
            {groups.map(([kind, ids]) => (
              <section key={kind} className={cn(CARD, 'overflow-hidden')}>
                <div className="flex items-center gap-2 px-3.5 py-3">
                  <span className={cn('inline-flex items-center gap-1 rounded-full px-3 py-1 text-[14px] font-black', KIND_STYLE[kind].cls)}>{KIND_STYLE[kind].emoji} {t(`chip.${kind}`)}</span>
                  <b className="flex-1 text-[15px] text-ink-900">{ids.length}</b>
                  <button type="button" disabled={busy} onClick={() => void save(ids.map((id) => ({ id, kind })))}
                    className="min-h-[36px] rounded-full bg-[#15803d] px-3.5 text-[13px] font-black text-white disabled:opacity-50">✓ לאשר את כולם</button>
                </div>
                {ids.map((id) => {
                  const e = byId.get(id)!;
                  const model = fromLibrarySteps(e.steps);
                  return (
                    <button key={id} type="button" onClick={() => setOpenId(id)}
                      className="flex w-full items-center gap-3 border-t-[0.5px] border-black/[0.08] px-3.5 py-2.5 text-start active:bg-page/60">
                      <span className="w-16 shrink-0">{model && <ProfileBar segments={profileBar(model, null)} size="sm" />}</span>
                      <span className="min-w-0 flex-1">
                        <bdi className="block truncate text-[14.5px] font-semibold text-ink-900">{e.name}</bdi>
                        <small className="block truncate text-12 text-ink-400">{detected.get(id)?.reason}</small>
                      </span>
                      <span className="text-[#c4c4c9]">‹</span>
                    </button>
                  );
                })}
              </section>
            ))}
          </div>
        </FlowScreen>
      )}
    </FlowOverlay>
  );
}

/** One entry, like the day's workout: its drawing and size, the detected type with why, ✓ or another type. */
function OneEntry({ entry, guess, busy, error, position, total, onBack, onChoose, onSkip }: {
  entry: LibraryEntry; guess: Classified; busy: boolean; error: string | null; position: number; total: number;
  onBack: () => void; onChoose: (k: LibraryKind) => void; onSkip: () => void;
}) {
  const t = useTranslations('workoutBook');
  const model = useMemo(() => fromLibrarySteps(entry.steps), [entry]);
  const size = useMemo(() => (model ? bookTotals(model, ESTIMATE_THRESHOLD_SEC) : null), [model]);
  const style = KIND_STYLE[guess.kind];
  return (
    <FlowScreen
      title="סיווג"
      leading={<BarButton onClick={onBack}>‹ כל הקבוצות</BarButton>}
      trailing={<span className="text-13 font-bold text-ink-400"><N>{position}</N> מתוך <N>{total}</N></span>}
      footer={
        <div className="space-y-2.5">
          <PrimaryButton onClick={() => onChoose(guess.kind)} disabled={busy}>✓ נכון, {t(`chip.${guess.kind}`)}</PrimaryButton>
          <div className="flex flex-wrap justify-center gap-1.5">
            {LIBRARY_KINDS.filter((k) => k !== guess.kind).map((k) => (
              <button key={k} type="button" disabled={busy} onClick={() => onChoose(k)}
                className="min-h-[38px] rounded-full bg-card px-3.5 text-[13px] font-extrabold text-ink-700 shadow-[0_1px_2px_rgba(0,0,0,0.08)]">{t(`chip.${k}`)}</button>
            ))}
            <button type="button" onClick={onSkip} className="min-h-[38px] px-2 text-[13px] font-bold text-ink-400">לדלג</button>
          </div>
        </div>
      }
    >
      <div className={cn(CARD, 'px-4 py-4')}>
        <h3 className="text-[21px] font-black leading-snug text-ink-900"><bdi>{entry.name}</bdi></h3>
        <p className="mt-0.5 text-13 text-ink-400">
          {size && size.distanceM > 0 && <><N className="font-bold text-ink-700">{kmText(size.distanceM)}</N> ק״מ · </>}
          {size && size.durationSec > 0 && <><N className="font-bold text-ink-700">{clockText(size.durationSec)}</N> · </>}
          {t.rich('uses', { ...RICH, count: entry.useCount })}
        </p>
        {model && <div className="mt-3"><ProfileBar segments={profileBar(model, null)} size="md" /></div>}
        <div className={cn('mt-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[15px] font-black', style.cls)}>
          {style.emoji} {t(`chip.${guess.kind}`)}
          <span className="text-[11px] font-extrabold opacity-70">{guess.confidence === 'sure' ? 'בטוח' : 'כנראה'}</span>
        </div>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-600"><b className="text-ink-900">למה:</b> {guess.reason}</p>
        {error && <p className="mt-2 text-center text-sm font-bold text-accent-red-ink">{error}</p>}
      </div>
    </FlowScreen>
  );
}
