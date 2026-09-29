'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, Share2, ImagePlus, Loader2, Eye, EyeOff } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Sheet } from '@/components/ui/Sheet';
import {
  renderShareCard, shareCard, supportsPhoto, supportsTransparent, workoutPaceBars,
  ACCENT_HEX, SHARE_ACCENT_KEYS, type ShareAccent, type ShareTemplate,
} from '@/lib/feed/share-image';
import { renderWeekShareCard, WEEK_LOGO_PLACEMENTS, type WeekLogoPlacement } from '@/lib/reports/week-share-image';
import { SHARE_CARD_LANGS, WORKOUT_CARD_TEXT, type ShareCardLang } from '@/lib/share/card-text';
import {
  FRAME_TEMPLATE, SHARE_FRAMES, asWeekMetrics, asWorkoutMetrics, defaultChipKeys, defaultExtraKeys,
  defaultTemplate, extraOn, fitChipKeys, fixedNumbersReason, frameCapacity, shareChips, shareExtras,
  shareFilename, shareFrames, shareTemplates, shareVerdict, supportsAccent, toggleChip,
  type ShareExtraKey, type ShareSubject,
} from '@/lib/share/sheet-model';

/**
 * ONE sheet for both cards — the workout and the week.
 *
 * What it looks like and why each control is where it is lives in
 * `lib/share/sheet-model.ts`. What this file adds is the shell that used to exist
 * twice: the preview, the chips, the language, the name, the photo, and the
 * save-vs-share fallback with its notice. It is the weekly sheet's shell, which was
 * the better of the two, and the workout card gains the card-language toggle and
 * "add my own photo" by arriving here — both of which only the weekly card had.
 *
 * TWO THINGS THE WORKOUT CARD DELIBERATELY DOES NOT GAIN:
 *  · a NAME. The workout card carries the run and nothing else, and that omission
 *    is what makes the share button gated to your own activity — see the docblock
 *    on `__tests__/feedShareOwnership.test.ts` (72949cd6). A name toggle here would
 *    quietly reopen a bug somebody reported in words.
 *  · a route frame with no GPS. It greys out and says why, like everything else.
 *
 * THE WORKOUT PICKS ONE OF TEN VIEWS, THE WEEK ONE OF THREE FRAMES. The weekly
 * renderer really has only a photo and a numbers panel; the workout renderer has
 * ten views, and the frame row had hidden seven of them. Each view is a thumbnail
 * of the athlete's own run, rendered once when the sheet opens.
 */
const VIEW_LABEL: Record<ShareTemplate, string> = {
  route: 'viewRoute',
  routeOnly: 'viewRouteOnly',
  bigNumbers: 'viewBigNumbers',
  statsBar: 'viewStatsBar',
  fullStats: 'viewFullStats',
  sideBySide: 'viewSideBySide',
  photo: 'viewPhoto',
  classic: 'viewClassic',
  card: 'viewCard',
  minimal: 'viewMinimal',
};

export function ShareSheet({ subject, onClose }: { subject: ShareSubject; onClose: () => void }) {
  const t = useTranslations('shareSheet');
  const tc = useTranslations('common');
  const locale = useLocale();
  const rtl = locale !== 'en';

  const frames = useMemo(() => shareFrames(subject), [subject]);
  const views = useMemo(() => shareTemplates(subject), [subject]);
  // The view being drawn. On the week it is only ever one of FRAME_TEMPLATE's three.
  const [template, setTemplate] = useState<ShareTemplate>(() => defaultTemplate(subject));
  const [keys, setKeys] = useState<string[]>(() => defaultChipKeys(subject, defaultTemplate(subject)));
  const [thumbs, setThumbs] = useState<Partial<Record<ShareTemplate, string>>>({});
  const [extras, setExtras] = useState<ShareExtraKey[]>(() => defaultExtraKeys(subject));
  // Opens in the app's own language, which is the one the athlete is reading in.
  const [cardLang, setCardLang] = useState<ShareCardLang>(rtl ? 'he' : 'en');
  const [withName, setWithName] = useState(true);
  // The run's own title — "keep or hide the run's name" (2.40.36). The merged sheet
  // dropped the control and the renderer kept defaulting it to on, so every workout
  // card has carried the name since, whether the athlete wanted it or not.
  const [showTitle, setShowTitle] = useState(true);
  const [showStartTime, setShowStartTime] = useState(false);
  const [accent, setAccent] = useState<ShareAccent>('white');
  const [logo, setLogo] = useState<WeekLogoPlacement>('above');
  const [sticker, setSticker] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const blobRef = useRef<Blob | null>(null);

  const i18n = WORKOUT_CARD_TEXT[cardLang];
  const chips = useMemo(() => shareChips(subject, i18n, cardLang), [subject, i18n, cardLang]);
  const capacity = frameCapacity(subject, template);
  const fixed = fixedNumbersReason(subject, template);
  const full = !fixed && keys.length >= capacity;
  const extraOpts = useMemo(() => shareExtras(subject, template), [subject, template]);
  // The bars and the verdict keep their state across a frame change and simply stop
  // drawing on a frame with no room for them, which is what the greyed toggle and
  // its one line say. Losing the choice would be a worse surprise than not drawing it.
  const barsOn = extraOn(subject, template, extras, 'bars');
  const verdictOn = extraOn(subject, template, extras, 'verdict');

  // The sticker export is a workout thing: the weekly renderer composites its own
  // panel and has no transparent variant, and `photo` is defined by its background.
  const stickerOk = subject.kind === 'workout' && supportsTransparent(template);
  const transparent = sticker && stickerOk;
  // The accent is the run's own line and nothing else, so it is offered where there
  // is a line to colour and nowhere else.
  const accentOk = supportsAccent(subject, template);
  const photoOk = supportsPhoto(template);
  const nameOk = subject.kind === 'week' && !!subject.athleteName;
  const titleOk = subject.kind === 'workout' && !!subject.item.activity?.activityName;
  // Only the two originals print a start time; the newer views have no slot for it.
  const startOk = subject.kind === 'workout' && (template === 'classic' || template === 'card');

  const pickTemplate = useCallback((next: ShareTemplate) => {
    setTemplate(next);
    // How many numbers fit is a property of the view, so the selection follows it
    // rather than staying oversized and being silently truncated by the renderer.
    setKeys(prev => fitChipKeys(subject, next, prev));
  }, [subject]);

  // The thumbnails: each view drawn once from this run with the opening choices,
  // one after another so the big preview is never queued behind ten of them.
  useEffect(() => {
    if (subject.kind !== 'workout') return;
    let cancelled = false;
    const urls: string[] = [];
    (async () => {
      for (const v of views) {
        if (!v.available) continue;
        try {
          const blob = await renderShareCard(subject.item, i18n, {
            template: v.key,
            metrics: asWorkoutMetrics(defaultChipKeys(subject, v.key)),
          });
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          urls.push(url);
          setThumbs(prev => ({ ...prev, [v.key]: url }));
        } catch {
          // A missing thumbnail leaves the label; the view itself still works.
        }
      }
    })();
    return () => {
      cancelled = true;
      urls.forEach(u => URL.revokeObjectURL(u));
    };
  }, [subject, views, i18n]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setRendering(true);
    setError(null);
    setNotice(null);

    const background = photoOk ? photo : null;
    const render = subject.kind === 'week'
      ? renderWeekShareCard(subject.report, {
        background,
        athleteName: withName ? subject.athleteName : null,
        metrics: asWeekMetrics(keys),
        lang: cardLang,
        bars: barsOn,
        logo,
      })
      : renderShareCard(subject.item, i18n, {
        background,
        transparent,
        template,
        accent,
        showTitle,
        showStartTime: startOk && showStartTime,
        metrics: asWorkoutMetrics(keys),
        bars: barsOn ? workoutPaceBars(subject.item.activity!, i18n) : null,
        verdict: verdictOn ? shareVerdict(subject, cardLang) : null,
      });

    render
      .then(blob => {
        if (cancelled) return;
        blobRef.current = blob;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
        setRendering(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(t('renderError'));
        setRendering(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [
    subject, photo, photoOk, keys, cardLang, withName, showTitle, showStartTime, startOk, i18n,
    template, transparent, accent, barsOn, verdictOn, logo, t,
  ]);

  const handleShare = useCallback(async () => {
    const blob = blobRef.current;
    if (!blob || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await shareCard(blob, shareFilename(subject, transparent));
      if (result === 'downloaded') setNotice(transparent ? t('savedSticker') : t('saved'));
      else onClose();
    } catch {
      setError(t('shareError'));
    } finally {
      setBusy(false);
    }
  }, [busy, subject, transparent, onClose, t]);

  return (
    <Sheet
      open
      onOpenChange={open => { if (!open) onClose(); }}
      title={subject.kind === 'week' ? t('titleWeek') : t('titleWorkout')}
      trailingAction={
        <button
          onClick={onClose}
          className="grid min-h-[44px] min-w-[44px] place-items-center rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-page hover:text-ink-900"
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
            {t('action')}
          </button>
        </div>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {/* The card first. Every control below changes it, and on a phone a preview
            under the controls meant scrolling away from each change to see it.
            9:16, the frame the story will actually be. The checkerboard makes alpha
            visible for the sticker variant — on a flat panel it reads as black. */}
        <div
          className="relative mx-auto mb-4 overflow-hidden rounded-xl border border-page"
          style={{
            aspectRatio: '9 / 16',
            maxHeight: '40vh',
            width: 'auto',
            backgroundColor: '#DFDFDF',
            backgroundImage: transparent
              ? 'linear-gradient(45deg,#BBBBBB 25%,transparent 25%),linear-gradient(-45deg,#BBBBBB 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#BBBBBB 75%),linear-gradient(-45deg,transparent 75%,#BBBBBB 75%)'
              : undefined,
            backgroundSize: '20px 20px',
            backgroundPosition: '0 0,0 10px,10px -10px,-10px 0px',
          }}
        >
          {previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt={t('preview')} className="h-full w-full object-contain" />
          )}
          {rendering && (
            <div className="absolute inset-0 flex items-center justify-center bg-page">
              <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
            </div>
          )}
        </div>

        {/* ── 1. VIEW. The one choice no chip can express. ──────────────────── */}
        <p className="mb-2 text-xs font-light text-ink-400">{t('frameTitle')}</p>
        {subject.kind === 'workout' ? (
          <>
            {/* All ten at once, five by two: a rail that scrolls hides whatever is
                past its edge, which is how seven of these went missing before. */}
            <div className="grid grid-cols-5 gap-1.5">
              {views.map(v => {
                const on = template === v.key;
                return (
                  <button
                    key={v.key}
                    onClick={() => v.available && pickTemplate(v.key)}
                    disabled={!v.available}
                    aria-pressed={on}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-lg p-0.5 transition-colors',
                      !v.available ? 'cursor-default opacity-40' : on ? 'text-brand-600' : 'text-ink-400',
                    )}
                  >
                    <span
                      className={cn(
                        'block w-full overflow-hidden rounded-md border-2 bg-page',
                        on ? 'border-brand-600' : 'border-transparent',
                      )}
                      style={{ aspectRatio: '9 / 16' }}
                    >
                      {thumbs[v.key] && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumbs[v.key]} alt="" className="h-full w-full object-cover" />
                      )}
                    </span>
                    <span className="text-3xs font-bold leading-tight">{t(VIEW_LABEL[v.key])}</span>
                  </button>
                );
              })}
            </div>
            {views.some(v => !v.available) && (
              <p className="mt-1.5 text-2xs text-ink-400" dir="auto">{t('noRouteViews')}</p>
            )}
          </>
        ) : (
          <>
            <div className="flex gap-2">
              {SHARE_FRAMES.map(key => {
                const opt = frames.find(f => f.key === key)!;
                const on = template === FRAME_TEMPLATE[key];
                return (
                  <button
                    key={key}
                    onClick={() => opt.available && pickTemplate(FRAME_TEMPLATE[key])}
                    disabled={!opt.available}
                    aria-pressed={on}
                    className={cn(
                      'flex-1 min-h-[44px] rounded-xl border py-2 text-xs font-bold transition-colors',
                      !opt.available
                        ? 'cursor-default border-page bg-page/60 text-ink-300'
                        : on
                          ? 'border-brand-600 bg-brand-600/10 text-brand-600'
                          : 'border-page text-ink-400 hover:text-ink-500',
                    )}
                  >
                    {t(key === 'photo' ? 'framePhoto' : key === 'route' ? 'frameRoute' : 'frameNumbers')}
                  </button>
                );
              })}
            </div>
            {/* A control that silently disappears teaches nobody anything. */}
            {frames.filter(f => !f.available && f.reason).map(f => (
              <p key={f.key} className="mt-1.5 text-2xs text-ink-400" dir="auto">{t(f.reason!)}</p>
            ))}
          </>
        )}

        {accentOk && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs font-light text-ink-400">{t('accentTitle')}</span>
            {SHARE_ACCENT_KEYS.map(a => (
              <button
                key={a}
                onClick={() => setAccent(a)}
                aria-pressed={accent === a}
                className={cn(
                  'flex min-h-[44px] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                  accent === a
                    ? 'border-brand-600 bg-brand-600/10 text-brand-600'
                    : 'border-page text-ink-400 hover:text-ink-500',
                )}
              >
                <span
                  className="h-3 w-3 rounded-full border border-black/20"
                  style={{ backgroundColor: ACCENT_HEX[a] }}
                />
                {t(a === 'white' ? 'accentWhite' : 'accentOrange')}
              </button>
            ))}
          </div>
        )}

        {/* The weekly card's two placements of the club mark (feedback #69). A
            layout choice, so it sits with the frame; the workout card places its
            mark per frame template and has nothing to choose here. */}
        {subject.kind === 'week' && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs font-light text-ink-400">{t('logoTitle')}</span>
            {WEEK_LOGO_PLACEMENTS.map(p => (
              <button
                key={p}
                onClick={() => setLogo(p)}
                aria-pressed={logo === p}
                className={cn(
                  'min-h-[44px] rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                  logo === p
                    ? 'border-brand-600 bg-brand-600/10 text-brand-600'
                    : 'border-page text-ink-400 hover:text-ink-500',
                )}
              >
                {t(p === 'above' ? 'logoAbove' : 'logoInside')}
              </button>
            ))}
          </div>
        )}

        {/* ── 2. CONTENT. Each chip carries its own real value. ─────────────── */}
        <p className="mb-2 mt-4 text-xs font-light text-ink-400">{t('contentTitle')}</p>
        <div className="flex flex-wrap gap-2">
          {chips.map(chip => {
            const on = !fixed && keys.includes(chip.key);
            const blocked = !!fixed || (!on && full);
            return (
              <button
                key={chip.key}
                onClick={() => setKeys(prev => toggleChip(prev, chip.key, capacity))}
                disabled={blocked}
                aria-pressed={on}
                // An English chip laid out right-to-left put the unit before the
                // number ("km 12.43"); it reads the way the English card prints it.
                dir={cardLang === 'en' ? 'ltr' : undefined}
                className={cn(
                  'min-h-[44px] rounded-full border px-3 py-1.5 text-start transition-colors',
                  on
                    ? 'border-brand-600 bg-brand-600/10 text-brand-600'
                    : blocked
                      ? 'cursor-default border-page text-ink-300'
                      : 'border-page text-ink-400 hover:text-ink-500',
                )}
              >
                <span className="block text-3xs font-medium leading-tight opacity-70">{chip.label}</span>
                <span className="block text-xs font-bold leading-tight">
                  <bdi dir="ltr">{chip.value}</bdi>
                  {chip.unit ? ` ${chip.unit}` : ''}
                </span>
              </button>
            );
          })}
        </div>
        {fixed && (
          <p className="mt-1.5 text-2xs text-ink-400" dir="auto">{t(fixed)}</p>
        )}
        {full && chips.length > capacity && (
          <p className="mt-1.5 text-2xs text-ink-400" dir="auto">{t('contentFull', { count: capacity })}</p>
        )}

        {/* The two that are not numbers. Square-cornered rather than pill-shaped, so
            it is visible at a glance that they do not compete for the stat row. */}
        {extraOpts.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {extraOpts.map(opt => {
              const on = opt.key === 'bars' ? barsOn : verdictOn;
              return (
                <button
                  key={opt.key}
                  onClick={() => opt.available && setExtras(prev => (
                    prev.includes(opt.key) ? prev.filter(k => k !== opt.key) : [...prev, opt.key]
                  ))}
                  disabled={!opt.available}
                  aria-pressed={on}
                  className={cn(
                    'min-h-[44px] rounded-xl border px-3 py-1.5 text-xs font-bold transition-colors',
                    !opt.available
                      ? 'cursor-default border-page bg-page/60 text-ink-300'
                      : on
                        ? 'border-brand-600 bg-brand-600/10 text-brand-600'
                        : 'border-page text-ink-400 hover:text-ink-500',
                  )}
                >
                  {opt.key === 'verdict'
                    ? t('extraVerdict')
                    : t(subject.kind === 'week' ? 'extraDays' : 'extraSplits')}
                </button>
              );
            })}
          </div>
        )}
        {/* Deduped: both extras go grey for the same reason on a frame with no room,
            and printing that line twice reads as two different problems. */}
        {[...new Set(extraOpts.filter(o => !o.available && o.reason).map(o => o.reason!))].map(r => (
          <p key={r} className="mt-1.5 text-2xs text-ink-400" dir="auto">
            {t(r === 'needsNumbers' && subject.kind === 'workout' ? 'needsFullStats' : r)}
          </p>
        ))}

        {/* ── 3. WORDING. Both of these are about the audience OUTSIDE the club,
               which is why they are a per-share decision and not a setting. ── */}
        <p className="mb-2 mt-4 text-xs font-light text-ink-400">{t('wordingTitle')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-full bg-page p-0.5">
            {SHARE_CARD_LANGS.map(l => (
              <button
                key={l}
                onClick={() => setCardLang(l)}
                aria-pressed={cardLang === l}
                className={cn(
                  'min-h-[44px] rounded-full px-3 py-1 text-xs font-bold transition-colors',
                  cardLang === l ? 'bg-card text-ink-700 shadow-sm' : 'text-ink-400',
                )}
              >
                {l === 'he' ? 'עברית' : 'English'}
              </button>
            ))}
          </div>
          {nameOk && (
            <button
              onClick={() => setWithName(v => !v)}
              aria-pressed={withName}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors',
                withName
                  ? 'border-brand-600 bg-brand-600/10 text-brand-600'
                  : 'border-page text-ink-400 hover:text-ink-500',
              )}
            >
              {withName ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              {withName ? t('nameOn') : t('nameOff')}
            </button>
          )}
          {titleOk && (
            <button
              onClick={() => setShowTitle(v => !v)}
              aria-pressed={showTitle}
              className={cn(
                'flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors',
                showTitle
                  ? 'border-brand-600 bg-brand-600/10 text-brand-600'
                  : 'border-page text-ink-400 hover:text-ink-500',
              )}
            >
              {showTitle ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              {showTitle ? t('titleOn') : t('titleOff')}
            </button>
          )}
          {startOk && (
            <button
              onClick={() => setShowStartTime(v => !v)}
              aria-pressed={showStartTime}
              className={cn(
                'flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors',
                showStartTime
                  ? 'border-brand-600 bg-brand-600/10 text-brand-600'
                  : 'border-page text-ink-400 hover:text-ink-500',
              )}
            >
              {showStartTime ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              {showStartTime ? t('startOn') : t('startOff')}
            </button>
          )}
          {stickerOk && (
            <button
              onClick={() => setSticker(v => !v)}
              aria-pressed={sticker}
              className={cn(
                'min-h-[44px] rounded-full border px-3 py-1.5 text-xs font-bold transition-colors',
                sticker
                  ? 'border-brand-600 bg-brand-600/10 text-brand-600'
                  : 'border-page text-ink-400 hover:text-ink-500',
              )}
            >
              {t('sticker')}
            </button>
          )}
        </div>

        {/* ── 4. PHOTO. Last, because it is the only one that opens a file picker,
               and offered only on the frame that can composite one. ────────── */}
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
        {photoOk && (
          <button
            onClick={() => fileRef.current?.click()}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-page py-2.5 text-sm font-medium text-ink-500 transition-colors hover:bg-ink-300/40"
          >
            <ImagePlus className="h-4 w-4" />
            {photo ? t('changePhoto') : t('addPhoto')}
          </button>
        )}

        {transparent && (
          <p className="mt-4 text-center text-xs leading-relaxed text-ink-400">{t('stickerHint')}</p>
        )}
        {notice && <p className="mt-3 text-center text-xs text-accent-400">{notice}</p>}
        {error && <p className="mt-3 text-center text-xs text-accent-red">{error}</p>}
      </div>
    </Sheet>
  );
}
