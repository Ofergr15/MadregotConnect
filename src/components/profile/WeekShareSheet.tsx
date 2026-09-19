'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, Share2, ImagePlus, Loader2, Eye, EyeOff } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Sheet } from '@/components/ui/Sheet';
import { shareCard } from '@/lib/feed/share-image';
import { renderWeekShareCard } from '@/lib/reports/week-share-image';
import {
  availableMetrics, defaultMetricKeys,
  type WeekCardLang, type WeekMetricKey,
} from '@/lib/reports/week-share';
import type { Last7Report } from '@/lib/reports/last-7-days';

/**
 * Sharing the seven-day report to a story.
 *
 * The chips are the point of the sheet, not decoration: the club's athletes do not
 * agree on what a week is worth showing — some post kilometres, some post the
 * climbing — and one fixed card would have made half of them not post at all.
 * Only metrics this athlete's own week carries are offered (see availableMetrics),
 * so nobody is handed a chip that would render a dash.
 *
 * At least one has to stay on: an empty panel is not a share, it is a bug that
 * looks like one, so the last chip cannot be turned off.
 *
 * Three things beyond the metrics, all for the same reason — this file leaves the
 * club: the card's LANGUAGE is chosen here rather than inherited from the app (the
 * app is Hebrew; a story's audience often is not), the NAME can be left off, and
 * there is no photo unless the athlete adds one, because a stock club photo behind
 * somebody's own week is a picture they did not choose to post.
 */
export function WeekShareSheet({
  report, athleteName, onClose,
}: {
  report: Last7Report;
  athleteName?: string | null;
  onClose: () => void;
}) {
  const t = useTranslations('profile');
  const tc = useTranslations('common');
  const locale = useLocale();
  const rtl = locale !== 'en';

  const metrics = useMemo(() => availableMetrics(report), [report]);
  const [keys, setKeys] = useState<WeekMetricKey[]>(() => defaultMetricKeys(report));
  // Opens in the app's own language, which is the one the athlete is reading in.
  const [cardLang, setCardLang] = useState<WeekCardLang>(rtl ? 'he' : 'en');
  const [withName, setWithName] = useState(true);
  const [photo, setPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const blobRef = useRef<Blob | null>(null);

  const labels = useMemo(() => ({
    km: t('weekShareKm'),
    time: t('weekShareHours'),
    pace: t('weekSharePace'),
    runs: t('weekShareRuns'),
    elev: t('weekShareElev'),
    cal: t('weekShareCal'),
  }), [t]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setRendering(true);
    setError(null);
    setNotice(null);

    renderWeekShareCard(report, {
      background: photo,
      athleteName: withName ? athleteName : null,
      metrics: keys,
      lang: cardLang,
    })
      .then((blob) => {
        if (cancelled) return;
        blobRef.current = blob;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
        setRendering(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(t('weekShareError'));
        setRendering(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [report, photo, keys, cardLang, withName, athleteName, t]);

  const toggle = useCallback((key: WeekMetricKey) => {
    setKeys((prev) => {
      if (!prev.includes(key)) return [...prev, key];
      // The last one standing stays on — see the docblock.
      return prev.length === 1 ? prev : prev.filter((k) => k !== key);
    });
  }, []);

  const handleShare = useCallback(async () => {
    const blob = blobRef.current;
    if (!blob || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await shareCard(blob, `madregot-week-${report.to}.jpg`);
      if (result === 'downloaded') setNotice(t('weekShareSaved'));
      else onClose();
    } catch {
      setError(t('weekShareError'));
    } finally {
      setBusy(false);
    }
  }, [busy, report.to, onClose, t]);

  return (
    <Sheet
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={t('weekShareTitle')}
      trailingAction={
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-page hover:text-ink-900"
          aria-label={tc('close')}
        >
          <X className="h-5 w-5" />
        </button>
      }
      className="max-h-[92vh]"
      bodyClassName="flex-1 min-h-0 p-0"
      footer={
        <div className="flex-none border-t border-page px-5 pb-4 pt-2">
          <button
            onClick={handleShare}
            disabled={rendering || busy || !previewUrl}
            className={cn(
              'flex w-full items-center justify-center gap-2 rounded-xl py-3 font-bold transition-all active:scale-[0.98]',
              rendering || busy || !previewUrl ? 'bg-page text-ink-400' : 'bg-brand-600 text-white',
            )}
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Share2 className="h-5 w-5" />}
            {t('weekShareAction')}
          </button>
        </div>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <p className="mb-2 text-xs font-light text-ink-400">{t('weekShareWhat')}</p>
        <div className="mb-4 flex flex-wrap gap-2">
          {metrics.map((m) => {
            const on = keys.includes(m.key);
            return (
              <button
                key={m.key}
                onClick={() => toggle(m.key)}
                aria-pressed={on}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs font-bold transition-colors',
                  on
                    ? 'border-brand-600 bg-brand-600/10 text-brand-600'
                    : 'border-page text-ink-400 hover:text-ink-500',
                )}
              >
                {labels[m.key]}
              </button>
            );
          })}
        </div>

        {/* The card's language, and whether it carries a name. Both are about the
            audience outside the club, so they sit with the chips and not in
            settings: they are a per-share decision, not a preference. */}
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex rounded-full bg-page p-0.5">
            {(['he', 'en'] as WeekCardLang[]).map((l) => (
              <button
                key={l}
                onClick={() => setCardLang(l)}
                aria-pressed={cardLang === l}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-bold transition-colors',
                  cardLang === l ? 'bg-card text-ink-700 shadow-sm' : 'text-ink-400',
                )}
              >
                {l === 'he' ? 'עברית' : 'English'}
              </button>
            ))}
          </div>
          {athleteName && (
            <button
              onClick={() => setWithName((v) => !v)}
              aria-pressed={withName}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors',
                withName
                  ? 'border-brand-600 bg-brand-600/10 text-brand-600'
                  : 'border-page text-ink-400 hover:text-ink-500',
              )}
            >
              {withName ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              {t('weekShareName')}
            </button>
          )}
        </div>

        {/* 9:16, the frame the story will actually be. */}
        <div
          className="relative mx-auto overflow-hidden rounded-xl border border-page"
          style={{ aspectRatio: '9 / 16', maxHeight: '46vh', width: 'auto', backgroundColor: '#DFDFDF' }}
        >
          {previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt={t('weekSharePreview')} className="h-full w-full object-contain" />
          )}
          {rendering && (
            <div className="absolute inset-0 flex items-center justify-center bg-page">
              <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
            </div>
          )}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setPhoto(f);
            e.target.value = '';
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-page py-2.5 text-sm font-medium text-ink-500 transition-colors hover:bg-ink-300/40"
        >
          <ImagePlus className="h-4 w-4" />
          {photo ? t('weekShareChangePhoto') : t('weekShareAddPhoto')}
        </button>

        {notice && <p className="mt-3 text-center text-xs text-accent-400">{notice}</p>}
        {error && <p className="mt-3 text-center text-xs text-accent-red">{error}</p>}
      </div>
    </Sheet>
  );
}
