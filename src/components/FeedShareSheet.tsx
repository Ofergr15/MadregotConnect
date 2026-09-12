'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, Share2, ImagePlus, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';
import {
  renderShareCard,
  shareCard,
  templatesForActivity,
  supportsPhoto,
  supportsTransparent,
  LEGACY_TEMPLATE_KEYS,
  SHARE_ACCENT_KEYS,
  ACCENT_HEX,
  DEFAULT_SHARE_TEMPLATE,
} from '@/lib/feed/share-image';
import { Sheet } from '@/components/ui/Sheet';
import type { ShareTemplate, ShareAccent } from '@/lib/feed/share-image';
import type { FeedItem } from '@/lib/feed/project';

type Style = 'photo' | 'transparent';

const TEMPLATE_LABELS: Record<ShareTemplate, string> = {
  classic: 'templateClassic',
  card: 'templateCard',
  minimal: 'templateMinimal',
  photo: 'templatePhoto',
  route: 'templateRoute',
  routeOnly: 'templateRouteOnly',
  statsBar: 'templateStatsBar',
  fullStats: 'templateFullStats',
  sideBySide: 'templateSideBySide',
  bigNumbers: 'templateBigNumbers',
};

const ACCENT_LABELS: Record<ShareAccent, string> = {
  white: 'accentWhite',
  orange: 'accentOrange',
};

interface Props {
  item: FeedItem;
  onClose: () => void;
}

export function FeedShareSheet({ item, onClose }: Props) {
  const t = useTranslations('feed');
  const ts = useTranslations('feed.share');
  // A run with no GPS trace has nothing to put on the three route views, so they
  // are dropped from the rail rather than offered and then rendered empty.
  const available = useMemo(
    () => (item.activity ? templatesForActivity(item.activity) : LEGACY_TEMPLATE_KEYS),
    [item.activity],
  );

  const [style, setStyle] = useState<Style>('photo');
  const [template, setTemplate] = useState<ShareTemplate>(
    available.includes(DEFAULT_SHARE_TEMPLATE) ? DEFAULT_SHARE_TEMPLATE : available[0],
  );
  const [accent, setAccent] = useState<ShareAccent>('white');
  const [showTitle, setShowTitle] = useState(true);
  const [photo, setPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const blobRef = useRef<Blob | null>(null);
  const selectedChipRef = useRef<HTMLButtonElement>(null);

  const photoOk = supportsPhoto(template);
  const transparentOk = supportsTransparent(template);
  // Which background controls make sense depends on the view, so the row is
  // narrowed instead of left showing a choice that the renderer would ignore.
  const effectiveStyle: Style = style === 'transparent' && !transparentOk ? 'photo' : style;

  // The rail opens on the default view, which is not the first chip — scroll it
  // into view so the athlete can see there are choices on both sides of it.
  useEffect(() => {
    selectedChipRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
    // Deliberately mount-only: re-running on every pick would fight the athlete's
    // own scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setRendering(true);
    setError(null);
    setNotice(null);

    renderShareCard(
      item,
      {
        km: t('km'),
        perKm: t('perKm'),
        pace: ts('cardPace'),
        time: ts('cardTime'),
        hr: ts('cardHr'),
        distance: ts('cardDistance'),
        elevation: ts('cardElevation'),
        calories: ts('cardCalories'),
        metres: ts('cardMetres'),
      },
      {
        background: photo,
        transparent: effectiveStyle === 'transparent',
        template,
        accent,
        showTitle,
      },
    )
      .then(blob => {
        if (cancelled) return;
        blobRef.current = blob;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
        setRendering(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(ts('renderError'));
        setRendering(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [item, photo, effectiveStyle, template, accent, showTitle, t, ts]);

  const handleShare = useCallback(async () => {
    const blob = blobRef.current;
    if (!blob || busy) return;
    setBusy(true);
    setError(null);
    try {
      const ext = blob.type === 'image/png' ? 'png' : 'jpg';
      const result = await shareCard(blob, `madregot-${item.id.slice(0, 8)}.${ext}`);
      if (result === 'downloaded') {
        setNotice(
          effectiveStyle === 'transparent'
            ? ts('savedSticker')
            : ts('saved'),
        );
      } else {
        onClose();
      }
    } catch {
      setError(ts('shareError'));
    } finally {
      setBusy(false);
    }
  }, [busy, item.id, effectiveStyle, onClose, ts]);

  return (
    <Sheet
      open
      onOpenChange={open => { if (!open) onClose(); }}
      title={ts('title')}
      trailingAction={
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-ink-400 hover:text-ink-900 hover:bg-page transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
          aria-label={t('close')}
        >
          <X className="h-5 w-5" />
        </button>
      }
      className="max-h-[92vh]"
      bodyClassName="flex-1 min-h-0 p-0"
      footer={
        <div className="flex-none px-5 pt-2 pb-4 border-t border-page">
          <button
            onClick={handleShare}
            disabled={rendering || busy || !previewUrl}
            className={cn(
              'w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all active:scale-[0.98]',
              rendering || busy || !previewUrl
                ? 'bg-page text-ink-400'
                : 'bg-brand-600 text-white',
            )}
          >
            {busy
              ? <Loader2 className="h-5 w-5 animate-spin" />
              : <Share2 className="h-5 w-5" />}
            {ts('action')}
          </button>
        </div>
      }
    >
      <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
          {/* Ten views is too many for a row of equal chips, so the rail scrolls
              and carries each view's name — the old chips were unlabelled, which
              is what made three of them feel like the whole story. Split into
              what is new and what has always been here, so nothing looks retired. */}
          <div className="mb-3 -mx-5 px-5 overflow-x-auto">
            <div className="flex items-end gap-2 w-max">
              {(['new', 'existing'] as const).map(band => {
                const keys = available.filter(k =>
                  band === 'existing' ? LEGACY_TEMPLATE_KEYS.includes(k) : !LEGACY_TEMPLATE_KEYS.includes(k),
                );
                if (!keys.length) return null;
                return (
                  <div key={band} className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-ink-400 px-0.5">
                      {ts(band === 'existing' ? 'bandExisting' : 'bandNew')}
                    </span>
                    <div className="flex gap-2">
                      {keys.map(key => (
                        <button
                          key={key}
                          ref={template === key ? selectedChipRef : undefined}
                          onClick={() => setTemplate(key)}
                          className={cn(
                            'whitespace-nowrap px-3 py-2 rounded-xl text-sm font-semibold transition-colors',
                            template === key
                              ? 'bg-brand-600 text-white'
                              : 'bg-page text-ink-400 hover:text-ink-700',
                          )}
                        >
                          {ts(TEMPLATE_LABELS[key])}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* The accent is the route line and nothing else — the wordmark, the
              badge and every piece of type stay white in both schemes. */}
          <div className="flex items-center gap-2 mb-2.5">
            <span className="text-xs text-ink-400 font-medium">{ts('accentTitle')}</span>
            {SHARE_ACCENT_KEYS.map(a => (
              <button
                key={a}
                onClick={() => setAccent(a)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border',
                  accent === a
                    ? 'border-brand-600 text-brand-600 bg-brand-600/10'
                    : 'border-page text-ink-400 hover:text-ink-500',
                )}
              >
                <span
                  className="h-3 w-3 rounded-full border border-black/20"
                  style={{ backgroundColor: ACCENT_HEX[a] }}
                />
                {ts(ACCENT_LABELS[a])}
              </button>
            ))}
          </div>

          {transparentOk && (
            <div className="flex gap-2 mb-4">
              {([
                { key: 'photo', label: ts('backgroundPhoto') },
                { key: 'transparent', label: ts('backgroundTransparent') },
              ] as const).map(o => (
                <button
                  key={o.key}
                  onClick={() => setStyle(o.key)}
                  className={cn(
                    'flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors border',
                    effectiveStyle === o.key
                      ? 'border-brand-600 text-brand-600 bg-brand-600/10'
                      : 'border-page text-ink-400 hover:text-ink-500',
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}

          {item.activity?.activityName && template !== 'minimal' && (
            <div className="flex gap-2 mb-4">
              {([
                { on: true, label: ts('titleShow') },
                { on: false, label: ts('titleHide') },
              ] as const).map(o => (
                <button
                  key={String(o.on)}
                  onClick={() => setShowTitle(o.on)}
                  className={cn(
                    'flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors border',
                    showTitle === o.on
                      ? 'border-brand-600 text-brand-600 bg-brand-600/10'
                      : 'border-page text-ink-400 hover:text-ink-500',
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}

          {/* 9:16 preview. The checkerboard makes alpha visible for the sticker
              variant — on the sheet's dark panel it would look like a black card. */}
          <div
            className="relative mx-auto rounded-xl overflow-hidden border border-page"
            style={{
              aspectRatio: '9 / 16',
              maxHeight: '46vh',
              width: 'auto',
              backgroundColor: '#DFDFDF',
              backgroundImage:
                effectiveStyle === 'transparent'
                  ? 'linear-gradient(45deg,#BBBBBB 25%,transparent 25%),linear-gradient(-45deg,#BBBBBB 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#BBBBBB 75%),linear-gradient(-45deg,transparent 75%,#BBBBBB 75%)'
                  : undefined,
              backgroundSize: '20px 20px',
              backgroundPosition: '0 0,0 10px,10px -10px,-10px 0px',
            }}
          >
            {previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt={ts('preview')} className="w-full h-full object-contain" />
            )}
            {rendering && (
              <div className="absolute inset-0 flex items-center justify-center bg-page">
                <Loader2 className="h-6 w-6 text-brand-600 animate-spin" />
              </div>
            )}
          </div>

          {effectiveStyle === 'photo' && photoOk && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) setPhoto(f);
                  e.target.value = '';
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-page text-ink-500 text-sm font-medium hover:bg-ink-300/40 transition-colors"
              >
                <ImagePlus className="h-4 w-4" />
                {photo ? ts('changePhoto') : ts('addPhoto')}
              </button>
            </>
          )}

          {effectiveStyle === 'transparent' && (
            <p className="mt-4 text-xs text-ink-400 leading-relaxed text-center">
              {ts('stickerHint')}
            </p>
          )}

          {notice && <p className="mt-3 text-xs text-accent-400 text-center">{notice}</p>}
          {error && <p className="mt-3 text-xs text-accent-red text-center">{error}</p>}
      </div>
    </Sheet>
  );
}
