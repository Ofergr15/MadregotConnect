'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, Share2, ImagePlus, Loader2, Eye, EyeOff, RotateCcw, Check } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Sheet } from '@/components/ui/Sheet';
import { WorkoutShareEditor } from '@/components/share/WorkoutShareEditor';
import { WeekShareEditor } from '@/components/share/WeekShareEditor';
import { useIsSuperUser } from '@/lib/impersonation';
import {
  renderShareCard, shareCard, supportsPhoto, supportsTransparent, workoutPaceBars,
  ACCENT_HEX, SHARE_ACCENT_KEYS, SHARE_BRAND_KEYS, type ShareAccent, type ShareBrand, type ShareTemplate,
} from '@/lib/feed/share-image';
import { renderWeekShareCard, WEEK_LOGO_PLACEMENTS, type WeekLogoPlacement } from '@/lib/reports/week-share-image';
import { SHARE_CARD_LANGS, WORKOUT_CARD_TEXT, type ShareCardLang } from '@/lib/share/card-text';
import { localizeDefaultName } from '@/lib/share/default-name';
import {
  FRAME_TEMPLATE, SHARE_FRAMES, asWeekMetrics, asWorkoutMetrics, defaultChipKeys, defaultExtraKeys,
  defaultTemplate, drawnTemplate, extraOn, fitChipKeys, fixedNumbersReason, frameCapacity, shareChips, shareExtras,
  shareFilename, shareFrames, shareTemplates, shareVerdict, supportsAccent, toggleChip, canSegment, canHrLine, viewBrand,
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
 * THE WORKOUT PICKS ONE OF SIX VIEWS, THE WEEK ONE OF THREE FRAMES. The weekly
 * renderer really has only a photo and a numbers panel. Each workout view is a
 * thumbnail of the athlete's own run, rendered once when the sheet opens; the
 * route view's "route only" switch and the background row pick the variant that
 * is actually drawn (`drawnTemplate`).
 */
type WorkoutBackground = 'photo' | 'club' | 'sticker';

/** The item with the athlete's own title for this card; the stored activity is untouched. */
function cardItem<T extends { activity?: { activityName?: string | null } | null }>(item: T, title: string): T {
  if (!item.activity || item.activity.activityName === title) return item;
  return { ...item, activity: { ...item.activity, activityName: title.trim() } };
}

/** The white logos, for the picker's own buttons: the same files the card draws. */
const BRAND_SRC: Record<ShareBrand, string> = {
  badge: '/images/logo-white.png',
  wordmark: '/images/wordmark-white.png',
  stairs: '/images/stairs-white.png',
};

const VIEW_LABEL: Record<ShareTemplate, string> = {
  splits: 'viewSplits',
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

/**
 * The workout opens the full-screen editor, where the card itself is the control
 * panel (`share/WorkoutShareEditor.tsx`), and so does the week, in the same flow
 * (`share/WeekShareEditor.tsx`). The sheet's branches stay below, unreached for
 * them, until the editors have been out a while: they are the way back if an
 * editor has to be pulled.
 */
/**
 * The full-screen editor is on for the super user only while it is tried out on
 * real runs; everyone else keeps this sheet, unchanged.
 */
export function ShareSheet({ subject, onClose }: { subject: ShareSubject; onClose: () => void }) {
  const editor = useIsSuperUser();
  if (subject.kind === 'workout' && editor) return <WorkoutShareEditor item={subject.item} onClose={onClose} />;
  if (subject.kind === 'week' && editor) {
    return (
      <WeekShareEditor
        report={subject.report}
        previous={subject.previous}
        nights={subject.nights}
        athleteName={subject.athleteName ?? null}
        onClose={onClose}
      />
    );
  }
  return <ClassicShareSheet subject={subject} onClose={onClose} />;
}

function ClassicShareSheet({ subject, onClose }: { subject: ShareSubject; onClose: () => void }) {
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
  const [showDate, setShowDate] = useState(true);
  // What the card calls the run. Until the athlete types, it is the watch's own name
  // in the CARD's language (#93: "Berlin ריצה" on an English card), so it follows
  // the language toggle; once they type, it is theirs and stays put. Either way it is
  // this one card only — renaming the run itself lives on the activity page (#92).
  const originalTitle = subject.kind === 'workout' ? subject.item.activity?.activityName ?? '' : '';
  const [typedTitle, setTypedTitle] = useState<string | null>(null);
  const [routeOnly, setRouteOnly] = useState(false);
  const [bg, setBg] = useState<WorkoutBackground>('club');
  const [accent, setAccent] = useState<ShareAccent>('white');
  const [logo, setLogo] = useState<WeekLogoPlacement>('above');
  const [tab, setTab] = useState<'design' | 'data' | 'text'>('design');
  // Null = the view's own logo (`viewBrand`); a pick lasts until the view changes.
  const [brand, setBrand] = useState<ShareBrand | null>(null);
  const segmentOk = canSegment(subject);
  // A workout with steps opens on its laps; a plain run on its kilometres.
  const [splitMode, setSplitMode] = useState<'km' | 'segments'>(() => (canSegment(subject) ? 'segments' : 'km'));
  const [avgLine, setAvgLine] = useState(true);
  const hrOk = canHrLine(subject);
  const [hrLine, setHrLine] = useState(true);
  const [photo, setPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const blobRef = useRef<Blob | null>(null);

  const i18n = WORKOUT_CARD_TEXT[cardLang];
  const titleText = typedTitle ?? localizeDefaultName(originalTitle, cardLang);
  const workout = subject.kind === 'workout';
  // The template the renderer draws: the view, or its route-only / own-photo variant.
  const drawn = workout
    ? drawnTemplate(template, { routeOnly, withPhoto: bg === 'photo' && !!photo })
    : template;
  const chips = useMemo(() => shareChips(subject, i18n, cardLang), [subject, i18n, cardLang]);
  const capacity = frameCapacity(subject, drawn);
  const fixed = fixedNumbersReason(subject, drawn);
  const full = !fixed && keys.length >= capacity;
  // Only the week has a footer now: on a workout the kilometre bars ARE a view.
  const extraOpts = useMemo(() => (workout ? [] : shareExtras(subject, template)), [workout, subject, template]);
  // The bars keep their state across a frame change and simply stop drawing on a
  // frame with no room for them, which is what the greyed toggle and its line say.
  const barsOn = extraOn(subject, drawn, extras, 'bars');
  const verdictOn = extraOn(subject, drawn, extras, 'verdict');

  // The sticker export is a workout thing: the weekly renderer composites its own
  // panel and has no transparent variant.
  const transparent = workout && bg === 'sticker' && supportsTransparent(drawn);
  // The accent is the run's own line and nothing else, so it is offered where there
  // is a line to colour and nowhere else.
  const accentOk = supportsAccent(subject, drawn);
  const photoOk = workout ? bg === 'photo' && supportsPhoto(drawn) : supportsPhoto(template);
  const nameOk = subject.kind === 'week' && !!subject.athleteName;
  const titleOk = workout && !!originalTitle;
  const dateOk = workout && template === 'splits';
  // Only the two originals print a start time; the newer views have no slot for it.
  const startOk = subject.kind === 'workout' && (template === 'classic' || template === 'card');

  const shownBrand = brand ?? viewBrand(template);

  const pickTemplate = useCallback((next: ShareTemplate) => {
    setTemplate(next);
    setBrand(null);
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
          const blob = await renderShareCard(cardItem(subject.item, titleText), i18n, {
            template: v.key,
            metrics: asWorkoutMetrics(defaultChipKeys(subject, v.key)),
            splitMode: canSegment(subject) ? 'segments' : 'km',
            avgLine: true,
            hrLine: true,
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a thumbnail is not redrawn per keystroke
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
      : renderShareCard(cardItem(subject.item, titleText), i18n, {
        background,
        transparent,
        template: drawn,
        accent,
        showTitle: showTitle && titleText.trim().length > 0,
        showStartTime: startOk && showStartTime,
        showDate,
        brand: brand ?? undefined,
        splitMode: segmentOk ? splitMode : 'km',
        avgLine,
        hrLine,
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
    subject, photo, photoOk, keys, cardLang, withName, showTitle, titleText, showStartTime, startOk, i18n,
    drawn, showDate, transparent, accent, barsOn, verdictOn, logo, brand, splitMode, segmentOk, avgLine, hrLine, t,
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

        {/* Three tabs, one short group each, so the card above never scrolls away:
            how it looks, what it shows, what it says. */}
        <div className="mb-4 flex rounded-xl bg-page p-0.5">
          {(['design', 'data', 'text'] as const).map(k => (
            <button
              key={k}
              onClick={() => setTab(k)}
              aria-pressed={tab === k}
              className={cn(
                'min-h-[44px] flex-1 rounded-lg text-sm font-bold transition-colors',
                tab === k ? 'bg-card text-ink-900 shadow-sm' : 'text-ink-400',
              )}
            >
              {t(k === 'design' ? 'tabDesign' : k === 'data' ? 'tabData' : 'tabText')}
            </button>
          ))}
        </div>

        {tab === 'design' && (
          <>
        {/* ── 1. VIEW. The one choice no chip can express. ──────────────────── */}
        <p className="mb-2 text-xs font-light text-ink-400">{t('frameTitle')}</p>
        {subject.kind === 'workout' ? (
          <>
            {/* All six at once, three by two: a rail that scrolls hides whatever is
                past its edge, which is how seven views went missing before. */}
            <div className="grid grid-cols-3 gap-2">
              {views.map(v => {
                const on = template === v.key;
                return (
                  <button
                    key={v.key}
                    onClick={() => v.available && pickTemplate(v.key)}
                    disabled={!v.available}
                    aria-pressed={on}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-lg p-1.5 transition-colors',
                      !v.available ? 'cursor-default opacity-40' : on ? 'text-ink-900' : 'text-ink-400',
                    )}
                  >
                    {/* The card being edited has to read at a glance from the tiles
                        alone: a 2px blue edge on a blue thumbnail vanished (feedback
                        2026-09-29), so the chosen one gets the card's own orange, thick
                        and offset from the picture, and a tick in its corner. */}
                    <span
                      className={cn(
                        'relative block w-full overflow-hidden rounded-md bg-page transition-shadow',
                        on
                          ? 'shadow-[0_0_0_2px_#fff,0_0_0_5px_#FF5315]'
                          : 'shadow-[0_0_0_1px_rgba(0,0,0,0.06)]',
                      )}
                      style={{ aspectRatio: '9 / 16' }}
                    >
                      {thumbs[v.key] && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumbs[v.key]} alt="" className="h-full w-full object-cover" />
                      )}
                      {on && (
                        <span className="absolute end-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#FF5315] text-white shadow">
                          <Check size={13} strokeWidth={3} aria-hidden />
                        </span>
                      )}
                    </span>
                    <span className={cn('text-3xs font-bold leading-tight', on && 'text-ink-900')}>{t(VIEW_LABEL[v.key])}</span>
                  </button>
                );
              })}
            </div>
            {[...new Set(views.filter(v => !v.available && v.reason).map(v => v.reason!))].map(r => (
              <p key={r} className="mt-1.5 text-2xs text-ink-400" dir="auto">
                {t(r === 'noRoute' ? 'noRouteViews' : 'noSplitsView')}
              </p>
            ))}
            {template === 'route' && (
              <div className="mt-3 flex rounded-full bg-page p-0.5">
                {[false, true].map(only => (
                  <button
                    key={String(only)}
                    onClick={() => {
                      setRouteOnly(only);
                      setKeys(prev => fitChipKeys(subject, only ? 'routeOnly' : 'route', prev));
                    }}
                    aria-pressed={routeOnly === only}
                    className={cn(
                      'min-h-[44px] flex-1 rounded-full px-3 py-1 text-xs font-bold transition-colors',
                      routeOnly === only ? 'bg-card text-ink-700 shadow-sm' : 'text-ink-400',
                    )}
                  >
                    {t(only ? 'viewRouteOnly' : 'routeWithStats')}
                  </button>
                ))}
              </div>
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


        {/* The logo, as the three logos themselves. No "automatic": the view's own
            is simply the one selected when the view is picked, and says so. */}
        {workout && (
          <>
            <p className="mb-2 mt-4 text-xs font-light text-ink-400">{t('logoTitle')}</p>
            <div className="flex gap-2 pb-4">
              {SHARE_BRAND_KEYS.map(b => {
                const on = shownBrand === b;
                return (
                  <button
                    key={b}
                    onClick={() => setBrand(b)}
                    aria-pressed={on}
                    aria-label={t(b === 'badge' ? 'brandBadge' : b === 'wordmark' ? 'brandWordmark' : 'brandStairs')}
                    className="relative flex h-14 flex-1 items-center justify-center rounded-xl bg-[#1b2140] transition-shadow"
                    style={{ boxShadow: on ? '0 0 0 2px #fff, 0 0 0 4px #FF5315' : '0 0 0 1px rgba(0,0,0,0.06)' }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={BRAND_SRC[b]} alt="" className="max-h-9 max-w-[78%] object-contain" />
                    {b === viewBrand(template) && (
                      <span className="absolute -bottom-4 text-3xs font-bold text-ink-400">{t('brandOwn')}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
        {workout && (
          <>
            <p className="mb-2 mt-4 text-xs font-light text-ink-400">{t('backgroundTitle')}</p>
            <div className="flex flex-wrap gap-2">
              {(['photo', 'club', 'sticker'] as const).map(key => {
                // "My photo" before a photo exists opens the picker; choosing a file
                // is what switches the background, so the card never goes blank.
                const on = bg === key && (key !== 'photo' || !!photo);
                return (
                  <button
                    key={key}
                    onClick={() => {
                      if (key === 'photo' && (!photo || bg === 'photo')) fileRef.current?.click();
                      else setBg(key);
                    }}
                    aria-pressed={on}
                    className={cn(
                      'flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors',
                      on
                        ? 'border-brand-600 bg-brand-600/10 text-brand-600'
                        : 'border-page text-ink-400 hover:text-ink-500',
                    )}
                  >
                    {key === 'photo' && <ImagePlus className="h-3.5 w-3.5" />}
                    {key === 'photo'
                      ? (photo && bg === 'photo' ? t('changePhoto') : t('bgPhoto'))
                      : t(key === 'club' ? 'bgClub' : 'sticker')}
                  </button>
                );
              })}
            </div>
          </>
        )}
        {!workout && photoOk && (
          <button
            onClick={() => fileRef.current?.click()}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-page py-2.5 text-sm font-medium text-ink-500 transition-colors hover:bg-ink-300/40"
          >
            <ImagePlus className="h-4 w-4" />
            {photo ? t('changePhoto') : t('addPhoto')}
          </button>
        )}

          </>
        )}

        {tab === 'data' && (
          <>
        {/* KM Splits' two questions, which no other view has. */}
        {workout && template === 'splits' && (
          <>
            {segmentOk && (
              <>
                <p className="mb-2 text-xs font-light text-ink-400">{t('splitTitle')}</p>
                <div className="flex rounded-full bg-page p-0.5">
                  {(['km', 'segments'] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => setSplitMode(m)}
                      aria-pressed={splitMode === m}
                      className={cn(
                        'min-h-[44px] flex-1 rounded-full px-3 py-1 text-xs font-bold transition-colors',
                        splitMode === m ? 'bg-card text-ink-700 shadow-sm' : 'text-ink-400',
                      )}
                    >
                      {t(m === 'km' ? 'splitKm' : 'splitSegments')}
                    </button>
                  ))}
                </div>
              </>
            )}
            <button
              onClick={() => setAvgLine(v => !v)}
              aria-pressed={avgLine}
              className={cn(
                'flex min-h-[44px] w-full items-center justify-between rounded-xl border border-page bg-card px-3 text-sm font-bold text-ink-700',
                segmentOk && 'mt-2',
              )}
            >
              {t('avgLine')}
              <span className={cn('relative h-6 w-10 rounded-full transition-colors', avgLine ? 'bg-[#FF5315]' : 'bg-ink-300/60')}>
                <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', avgLine ? 'end-0.5' : 'start-0.5')} />
              </span>
            </button>
            {hrOk && splitMode === 'segments' && (
              <button
                onClick={() => setHrLine(v => !v)}
                aria-pressed={hrLine}
                className="mt-2 flex min-h-[44px] w-full items-center justify-between rounded-xl border border-page bg-card px-3 text-sm font-bold text-ink-700"
              >
                {t('hrLine')}
                <span className={cn('relative h-6 w-10 rounded-full transition-colors', hrLine ? 'bg-[#FF5315]' : 'bg-ink-300/60')}>
                  <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', hrLine ? 'end-0.5' : 'start-0.5')} />
                </span>
              </button>
            )}
          </>
        )}
        {/* ── 2. CONTENT. Each chip carries its own real value. ─────────────── */}
        {!(workout && template === 'splits') && (
          <>
        <p className="mb-2 text-xs font-light text-ink-400">{t('contentTitle')}</p>
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

          </>
        )}
        {/* The two that are not numbers. Square-cornered rather than pill-shaped, so
            it is visible at a glance that they do not compete for the stat row. */}
        {!workout && extraOpts.length > 0 && (
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

          </>
        )}

        {tab === 'text' && (
          <>
        {/* ── 3. WORDING. Both of these are about the audience OUTSIDE the club,
               which is why they are a per-share decision and not a setting. ── */}
        <p className="mb-2 text-xs font-light text-ink-400">{t('wordingTitle')}</p>
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
          {dateOk && (
            <button
              onClick={() => setShowDate(v => !v)}
              aria-pressed={showDate}
              className={cn(
                'flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors',
                showDate
                  ? 'border-brand-600 bg-brand-600/10 text-brand-600'
                  : 'border-page text-ink-400 hover:text-ink-500',
              )}
            >
              {showDate ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              {showDate ? t('dateOn') : t('dateOff')}
            </button>
          )}
        </div>

        {titleOk && showTitle && (
          <div className="mt-2 flex items-center gap-2 rounded-xl border border-page bg-card px-3 focus-within:border-brand-600">
            <input
              value={titleText}
              onChange={e => setTypedTitle(e.target.value.slice(0, 60))}
              aria-label={t('titleEdit')}
              placeholder={t('titleEdit')}
              dir="auto"
              className="min-h-[44px] min-w-0 flex-1 bg-transparent text-sm text-ink-700 outline-none"
            />
            {typedTitle !== null && (
              <button
                onClick={() => setTypedTitle(null)}
                aria-label={t('titleReset')}
                className="grid min-h-[44px] min-w-[44px] place-items-center text-ink-400 hover:text-ink-700"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

          </>
        )}

        {/* ── 4. PHOTO. Last, because it is the only one that opens a file picker,
               and offered only on the frame that can composite one. ────────── */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) {
              setPhoto(f);
              setBg('photo');
            }
            e.target.value = '';
          }}
        />
        {transparent && (
          <p className="mt-4 text-center text-xs leading-relaxed text-ink-400">{t('stickerHint')}</p>
        )}
        {notice && <p className="mt-3 text-center text-xs text-accent-400">{notice}</p>}
        {error && <p className="mt-3 text-center text-xs text-accent-red">{error}</p>}
      </div>
    </Sheet>
  );
}
