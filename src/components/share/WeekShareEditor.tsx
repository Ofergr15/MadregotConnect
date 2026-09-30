'use client';

import { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Share2, ImagePlus, Loader2, RotateCcw, Pencil, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { shareCard, SHARE_BRAND_KEYS, STORY_H, STORY_W, type ShareBrand } from '@/lib/feed/share-image';
import { renderWeekShareCard, WEEK_LOGO_PLACEMENTS, type WeekLogoPlacement } from '@/lib/reports/week-share-image';
import { WEEK_CARD_TEXT } from '@/lib/reports/week-share';
import { SHARE_CARD_LANGS, WORKOUT_CARD_TEXT, type ShareCardLang } from '@/lib/share/card-text';
import { partAt, placeLabels, type ShareBox, type ShareHitMap, type SharePart } from '@/lib/share/hit-map';
import { asWeekMetrics, defaultChipKeys, defaultTemplate, shareChips, shareFilename, toggleChip, type ShareSubject } from '@/lib/share/sheet-model';
import type { Last7Report } from '@/lib/reports/last-7-days';
import { BRAND_SRC, LABEL_H, OUTLINE_PAD, Toggle, labelWidth } from '@/components/share/editor-parts';

/**
 * THE WEEK'S SHARE EDITOR: THE SAME FLOW AS THE WORKOUT'S.
 *
 * "The weekly share doesn't have the editing the workout share has, it has to be
 * the same flow" (feedback 2026-09-30). So this is `WorkoutShareEditor`'s shell
 * with the week's card in it: the card fills the screen, the looks are a carousel,
 * Edit (or a tap on the card) labels every part on it, a label opens that part's
 * options, "‹ Edit" or a tap beside the card goes back, and the big button always
 * shares. The two files are kept in step by hand, and what they draw with is
 * shared (`editor-parts.tsx`).
 *
 * What differs is only what the week has:
 *
 *  · the looks are the two places for the club mark (feedback #69), above the
 *    panel or inside it;
 *  · logo: which of the three marks;
 *  · text: the title (typed, or the card's own "my week"), the athlete's name on or
 *    off, and the card's language;
 *  · the numbers: which rows, and the day-by-day bars under them;
 *  · background: the club photo or the athlete's own. There is no sticker: the
 *    weekly card composites its own frosted panel over the photo.
 *
 * Unlike the workout editor it does carry a name toggle: the week card has always
 * printed the athlete's name and let them take it off. The workout card never may.
 */
type WeekBackground = 'club' | 'photo';
type Mode = 'looks' | SharePart | 'background';

export function WeekShareEditor({ report, athleteName, onClose }: {
  report: Last7Report; athleteName?: string | null; onClose: () => void;
}) {
  const t = useTranslations('shareSheet');
  const tc = useTranslations('common');
  const locale = useLocale();
  const rtl = locale !== 'en';
  const subject = useMemo<ShareSubject>(() => ({ kind: 'week', report, athleteName }), [report, athleteName]);
  const chipsFrame = defaultTemplate(subject);

  const [look, setLook] = useState<WeekLogoPlacement>('above');
  const [keys, setKeys] = useState<string[]>(() => defaultChipKeys(subject, chipsFrame));
  const [cardLang, setCardLang] = useState<ShareCardLang>(rtl ? 'he' : 'en');
  const [withName, setWithName] = useState(true);
  const [typedTitle, setTypedTitle] = useState<string | null>(null);
  const [bars, setBars] = useState(false);
  const [brand, setBrand] = useState<ShareBrand>('badge');
  const [bg, setBg] = useState<WeekBackground>('club');
  const [photo, setPhoto] = useState<File | null>(null);

  const [mode, setMode] = useState<Mode>('looks');
  const [editing, setEditing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [hitMap, setHitMap] = useState<ShareHitMap>({});
  const [slideUrls, setSlideUrls] = useState<Partial<Record<WeekLogoPlacement, string>>>({});
  const [rendering, setRendering] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const blobRef = useRef<Blob | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [mounted, setMounted] = useState(false);

  const cardTitle = WEEK_CARD_TEXT[cardLang].title;
  const titleText = typedTitle ?? cardTitle;
  const chips = useMemo(() => shareChips(subject, WORKOUT_CARD_TEXT[cardLang], cardLang), [subject, cardLang]);
  const nameOk = !!athleteName?.trim();
  const inPart = mode !== 'looks';

  useEffect(() => {
    setMounted(true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const pickLook = useCallback((next: WeekLogoPlacement) => {
    setLook(next);
    setMode('looks');
    setHitMap({});
  }, []);
  const openPart = useCallback((next: Mode) => {
    if (next !== 'looks') setEditing(true);
    setMode(next);
  }, []);
  const back = useCallback(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    setMode('looks');
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (inPart) back(); else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, inPart, back]);

  // Blob URLs are let go only once their replacement is on screen, as in the workout editor.
  const liveUrls = useRef(new Map<string, string>());
  const swapUrl = useCallback((slot: string, url: string) => {
    const old = liveUrls.current.get(slot);
    liveUrls.current.set(slot, url);
    if (old) setTimeout(() => URL.revokeObjectURL(old), 1000);
    return url;
  }, []);
  useEffect(() => {
    const live = liveUrls.current;
    return () => { live.forEach(u => URL.revokeObjectURL(u)); live.clear(); };
  }, []);

  const renderOpts = useCallback((placement: WeekLogoPlacement) => ({
    background: bg === 'photo' ? photo : null,
    athleteName: withName && nameOk ? athleteName : null,
    metrics: asWeekMetrics(keys),
    lang: cardLang,
    bars,
    logo: placement,
    brand,
    title: typedTitle,
  }), [bg, photo, withName, nameOk, athleteName, keys, cardLang, bars, brand, typedTitle]);

  // The card being edited, with its tap areas.
  useEffect(() => {
    let cancelled = false;
    setRendering(true);
    setError(null);
    setNotice(null);
    renderWeekShareCard(report, { ...renderOpts(look), onHitMap: map => { if (!cancelled) setHitMap(map); } })
      .then(blob => {
        if (cancelled) return;
        blobRef.current = blob;
        setPreviewUrl(swapUrl('preview', URL.createObjectURL(blob)));
        setRendering(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(t('renderError'));
        setRendering(false);
      });
    return () => { cancelled = true; };
  }, [report, look, renderOpts, swapUrl, t]);

  // The other look, once the card is up, with the same choices, so a swipe lands on it ready.
  useEffect(() => {
    if (rendering) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      for (const p of WEEK_LOGO_PLACEMENTS.filter(p => p !== look)) {
        try {
          const blob = await renderWeekShareCard(report, renderOpts(p));
          if (cancelled) return;
          const url = swapUrl(`slide:${p}`, URL.createObjectURL(blob));
          setSlideUrls(prev => ({ ...prev, [p]: url }));
        } catch { /* the slide stays blank until it is picked */ }
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [rendering, look, report, renderOpts, swapUrl]);

  // ── Carousel geometry, as in the workout editor ────────────────────────────
  const [stage, setStage] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setStage({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [mounted]);
  const GAP = 12;
  let slideH = Math.max(0, stage.h - 16);
  let slideW = slideH * 9 / 16;
  if (slideW > stage.w - 72) { slideW = Math.max(0, stage.w - 72); slideH = slideW * 16 / 9; }
  const spacer = Math.max(0, (stage.w - slideW) / 2 - GAP);

  const [centred, setCentred] = useState<WeekLogoPlacement>(look);
  const settleRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dragRef = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const justDragged = useRef(false);

  const centredLook = useCallback((): WeekLogoPlacement | null => {
    const el = stageRef.current;
    if (!el) return null;
    const mid = el.getBoundingClientRect().left + el.clientWidth / 2;
    let best: WeekLogoPlacement | null = null, d = Infinity;
    el.querySelectorAll<HTMLElement>('[data-view]').forEach(s => {
      const r = s.getBoundingClientRect();
      const dd = Math.abs(r.left + r.width / 2 - mid);
      if (dd < d) { d = dd; best = s.dataset.view as WeekLogoPlacement; }
    });
    return best;
  }, []);
  const scrollTo = useCallback((v: WeekLogoPlacement, smooth = true) => {
    stageRef.current?.querySelector<HTMLElement>(`[data-view="${v}"]`)
      ?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', inline: 'center', block: 'nearest' });
  }, []);
  useEffect(() => {
    if (!slideW) return;
    if (centredLook() !== look) scrollTo(look, centred === look);
    setCentred(look);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only the look and the geometry move the carousel
  }, [look, slideW]);

  const onScroll = () => {
    const c = centredLook();
    if (c) setCentred(c);
    clearTimeout(settleRef.current);
    settleRef.current = setTimeout(() => {
      const v = centredLook();
      if (!dragRef.current && v && v !== look) pickLook(v);
    }, 140);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse' || inPart || !stageRef.current) return;
    dragRef.current = { x: e.clientX, left: stageRef.current.scrollLeft, moved: false };
  };
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = dragRef.current, el = stageRef.current;
      if (!d || !el) return;
      const dx = e.clientX - d.x;
      if (!d.moved && Math.abs(dx) > 5) { d.moved = true; el.style.scrollSnapType = 'none'; }
      if (d.moved) el.scrollLeft = d.left - dx;
    };
    const up = () => {
      const d = dragRef.current, el = stageRef.current;
      dragRef.current = null;
      if (!d?.moved || !el) return;
      el.style.scrollSnapType = '';
      justDragged.current = true;
      setTimeout(() => { justDragged.current = false; }, 50);
      const v = centredLook();
      if (v) { scrollTo(v); if (v !== look) pickLook(v); }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [centredLook, scrollTo, pickLook, look]);

  const onSlideClick = (v: WeekLogoPlacement, e: React.MouseEvent) => {
    if (justDragged.current) return;
    if (v !== look) { if (inPart) back(); else pickLook(v); return; }
    const r = imgRef.current?.getBoundingClientRect();
    if (!r) return;
    openPart(partAt(hitMap, ((e.clientX - r.left) / r.width) * STORY_W, ((e.clientY - r.top) / r.height) * STORY_H));
  };

  const handleShare = async () => {
    const blob = blobRef.current;
    if (!blob || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await shareCard(blob, shareFilename(subject, false));
      if (result === 'downloaded') setNotice(t('saved'));
      else onClose();
    } catch {
      setError(t('shareError'));
    } finally {
      setBusy(false);
    }
  };

  // ── The part outlines and labels over the card ─────────────────────────────
  const scale = slideW / STORY_W;
  const partName = (p: Mode): string => {
    if (p === 'logo') return t('logoTitle');
    if (p === 'text') return t('tabText');
    if (p === 'background') return t('backgroundTitle');
    if (p === 'data') return t('frameNumbers');
    return t('titleWeek');
  };
  const panelRef = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const checkMore = () => {
    const el = panelRef.current;
    setMore(!!el && el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  };
  useLayoutEffect(checkMore);

  const outline = (p: SharePart, box: ShareBox, on: boolean) => (
    <div
      key={p}
      className={cn('pointer-events-none absolute rounded-[10px]', on
        ? 'border-[2.5px] border-[#FF5315] shadow-[0_0_0_999px_rgba(5,6,18,0.5),0_0_0_5px_rgba(255,83,21,0.3)]'
        : 'border-[1.5px] border-dashed border-white/80')}
      style={{
        left: (box.x0 - OUTLINE_PAD) * scale, top: (box.y0 - OUTLINE_PAD) * scale,
        width: (box.x1 - box.x0 + 2 * OUTLINE_PAD) * scale, height: (box.y1 - box.y0 + 2 * OUTLINE_PAD) * scale,
      }}
    />
  );
  const labelled = (['logo', 'text', 'data'] as const).filter(p => hitMap[p]);
  const toScreen = (b: ShareBox) => ({
    x: (b.x0 - OUTLINE_PAD) * scale, y: (b.y0 - OUTLINE_PAD) * scale,
    w: (b.x1 - b.x0 + 2 * OUTLINE_PAD) * scale, h: (b.y1 - b.y0 + 2 * OUTLINE_PAD) * scale,
  });
  const labels = placeLabels(
    [
      ...labelled.map(p => ({ key: p, box: toScreen(hitMap[p]!), w: labelWidth(partName(p)) })),
      { key: 'background', box: { x: 6, y: slideH - 6 - 26, w: slideW - 12, h: 26 }, w: labelWidth(partName('background')) },
    ],
    { w: slideW, h: slideH },
    { h: LABEL_H, gap: 6, rtl, obstacles: (hitMap.logoPieces ?? []).map(toScreen) },
  );

  const pill = (label: string, on: boolean, onClick: () => void) => (
    <button
      key={label}
      onClick={onClick}
      aria-pressed={on}
      className={cn('min-h-[40px] rounded-full px-3.5 text-xs font-bold', on ? 'bg-[#FF5315] text-white' : 'bg-white/[0.08] text-white/80')}
    >
      {label}
    </button>
  );

  // ── The tray: the looks, or the options of the part that was tapped ─────────
  const tray = (() => {
    if (mode === 'data') {
      return (
        <>
          <div className="grid grid-cols-3 gap-1.5">
            {chips.map(chip => {
              const on = keys.includes(chip.key);
              return (
                <button
                  key={chip.key}
                  onClick={() => setKeys(prev => toggleChip(prev, chip.key, chips.length))}
                  aria-pressed={on}
                  className={cn('min-h-[44px] min-w-0 rounded-xl px-2 py-0.5 text-start', on ? 'bg-[#FF5315] text-white' : 'bg-white/[0.08] text-white/85')}
                >
                  <span className="block truncate text-3xs font-medium leading-tight opacity-80">{chip.label}</span>
                  <bdi dir="ltr" className="block truncate text-xs font-bold leading-tight">{chip.value}</bdi>
                </button>
              );
            })}
          </div>
          <div className="mt-2">
            <Toggle label={t('extraDays')} on={bars} onClick={() => setBars(v => !v)} />
          </div>
        </>
      );
    }
    if (mode === 'logo') {
      return (
        <div className="flex gap-2">
          {SHARE_BRAND_KEYS.map(b => (
            <button
              key={b}
              onClick={() => setBrand(b)}
              aria-pressed={brand === b}
              aria-label={t(b === 'badge' ? 'brandBadge' : b === 'wordmark' ? 'brandWordmark' : 'brandStairs')}
              className={cn(
                'flex h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl border-2 bg-white/[0.08]',
                brand === b ? 'border-[#FF5315]' : 'border-transparent',
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={BRAND_SRC[b]} alt="" className="max-h-7 max-w-[78%] object-contain" />
              {b === 'badge' && <span className="text-3xs font-bold text-white/55">{t('brandOwn')}</span>}
            </button>
          ))}
        </div>
      );
    }
    if (mode === 'text') {
      return (
        <>
          <div className="mb-2 flex items-center gap-1 rounded-xl bg-white px-3">
            <input
              value={titleText}
              onChange={e => setTypedTitle(e.target.value.slice(0, 60))}
              onKeyDown={e => { if (e.key === 'Enter') back(); }}
              enterKeyHint="done"
              aria-label={t('titleEdit')}
              placeholder={cardTitle}
              dir="auto"
              className="min-h-[44px] min-w-0 flex-1 bg-transparent text-sm font-bold text-ink-900 outline-none"
            />
            {typedTitle !== null && (
              <button
                onClick={() => setTypedTitle(null)}
                aria-label={t('titleReset')}
                className="grid min-h-[44px] min-w-[44px] place-items-center text-ink-400"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {nameOk && pill(t('partName'), withName, () => setWithName(v => !v))}
            <div className="ms-auto flex rounded-full bg-white/[0.08] p-0.5">
              {SHARE_CARD_LANGS.map(l => (
                <button
                  key={l}
                  onClick={() => setCardLang(l)}
                  aria-pressed={cardLang === l}
                  className={cn('min-h-[38px] rounded-full px-3 text-xs font-bold', cardLang === l ? 'bg-white text-ink-900' : 'text-white/60')}
                >
                  {l === 'he' ? 'עברית' : 'English'}
                </button>
              ))}
            </div>
          </div>
        </>
      );
    }
    if (mode === 'background') {
      const opt = (key: WeekBackground, label: string, swatch: string) => {
        const on = bg === key && (key !== 'photo' || !!photo);
        return (
          <button
            key={key}
            aria-pressed={on}
            onClick={() => {
              if (key === 'photo' && (!photo || bg === 'photo')) fileRef.current?.click();
              else setBg(key);
            }}
            className={cn(
              'flex h-[76px] flex-1 flex-col items-center justify-center gap-1.5 rounded-xl border-2 bg-white/[0.08] text-2xs font-bold text-white',
              on ? 'border-[#FF5315]' : 'border-transparent',
            )}
          >
            <span className={cn('grid h-7 w-7 place-items-center rounded-lg', swatch)}>
              {key === 'photo' && <ImagePlus className="h-4 w-4" />}
            </span>
            {label}
          </button>
        );
      };
      return (
        <div className="flex gap-2">
          {opt('club', t('bgClub'), "bg-[url('/images/runners-group.jpg')] bg-cover bg-center")}
          {opt('photo', photo && bg === 'photo' ? t('changePhoto') : t('bgPhoto'), 'bg-white/15')}
        </div>
      );
    }
    // The looks: the two places for the mark, both on screen.
    return (
      <div className="mx-auto flex max-w-[180px] gap-3">
        {WEEK_LOGO_PLACEMENTS.map(p => {
          const on = look === p;
          const src = on ? previewUrl : slideUrls[p];
          return (
            <button
              key={p}
              onClick={() => pickLook(p)}
              aria-pressed={on}
              className={cn('min-w-0 flex-1 text-center', on ? 'text-white' : 'text-white/55')}
            >
              <span
                className={cn('block w-full overflow-hidden rounded-lg border-2 bg-white/[0.08]', on ? 'border-[#FF5315]' : 'border-transparent')}
                style={{ aspectRatio: '9 / 16' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {src && <img src={src} alt="" className="h-full w-full object-cover" />}
              </span>
              <span className="mt-1 block truncate text-3xs font-bold">{t(p === 'above' ? 'logoAbove' : 'logoInside')}</span>
            </button>
          );
        })}
      </div>
    );
  })();

  if (!mounted) return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('titleWeek')}
      dir={rtl ? 'rtl' : 'ltr'}
      className="fixed inset-0 z-[310] flex select-none flex-col bg-[#0b0d1d] pt-[env(safe-area-inset-top)] text-white"
    >
      <div className="relative flex h-14 flex-none items-center justify-between px-3 [@media(max-height:699px)]:h-11">
        {inPart ? (
          <button
            type="button"
            onClick={back}
            className="flex min-h-[44px] items-center gap-0.5 rounded-lg pe-2 text-sm font-extrabold text-white"
          >
            {rtl ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
            {tc('edit')}
          </button>
        ) : (
          <button
            onClick={onClose}
            aria-label={tc('close')}
            className="grid min-h-[44px] min-w-[44px] place-items-center rounded-lg text-white/85"
          >
            <X className="h-5 w-5" />
          </button>
        )}
        <span className="pointer-events-none absolute inset-x-24 truncate text-center text-base font-extrabold">{inPart ? partName(mode) : t('titleWeek')}</span>
        <button
          onClick={() => { if (editing) { setEditing(false); back(); } else setEditing(true); }}
          aria-pressed={editing}
          className={cn(
            'flex min-h-[36px] min-w-[44px] items-center gap-1.5 rounded-full px-3.5 text-sm font-extrabold transition-colors',
            editing ? 'bg-white text-ink-900' : 'bg-white/[0.12] text-white',
          )}
        >
          {editing ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
          {editing ? tc('done') : tc('edit')}
        </button>
      </div>

      <div
        ref={stageRef}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onClick={e => { if (inPart && !(e.target as HTMLElement).closest('[data-view]')) back(); }}
        className={cn(
          'flex min-h-0 flex-1 items-center overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          inPart ? 'overflow-x-hidden' : 'snap-x snap-mandatory overflow-x-auto',
        )}
        style={{ gap: GAP }}
      >
        <span className="flex-none" style={{ width: spacer, height: 1 }} />
        {WEEK_LOGO_PLACEMENTS.map(p => {
          const own = p === look;
          const src = own ? previewUrl : slideUrls[p];
          return (
            <div
              key={p}
              data-view={p}
              onClick={e => onSlideClick(p, e)}
              className={cn(
                'relative flex-none snap-center snap-always cursor-pointer transition-[transform,opacity] duration-200',
                centred === p ? 'opacity-100' : 'scale-90 opacity-45',
              )}
              style={{ width: slideW, height: slideH }}
            >
              <div className="relative h-full w-full overflow-hidden rounded-2xl bg-white/[0.06] shadow-[0_8px_30px_rgba(0,0,0,0.5)]">
                {src && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    ref={own ? imgRef : undefined}
                    src={src}
                    alt={own ? t('preview') : t(p === 'above' ? 'logoAbove' : 'logoInside')}
                    draggable={false}
                    className="pointer-events-none h-full w-full"
                  />
                )}
                {own && rendering && (
                  <Loader2 className="absolute start-2.5 top-2.5 h-5 w-5 animate-spin text-white/70" />
                )}
                {own && !rendering && (
                  <>
                    {editing && labelled.filter(q => q !== mode).map(q => outline(q, hitMap[q]!, false))}
                    {inPart && mode !== 'background' && hitMap[mode] && outline(mode, hitMap[mode]!, true)}
                    {mode === 'background' && (
                      <div className="pointer-events-none absolute inset-1.5 rounded-xl border-[2.5px] border-[#FF5315]" />
                    )}
                    {editing && [...labelled, 'background' as const].map(q => {
                      const r = labels[q];
                      if (!r) return null;
                      const on = mode === q;
                      return (
                        <button
                          key={`label-${q}`}
                          type="button"
                          aria-pressed={on}
                          onClick={e => { e.stopPropagation(); if (on) back(); else openPart(q); }}
                          className={cn(
                            'absolute whitespace-nowrap rounded-full text-center text-3xs font-extrabold shadow-[0_2px_6px_rgba(0,0,0,0.45)] transition-colors',
                            "after:absolute after:-inset-x-1 after:-inset-y-1.5 after:content-['']",
                            on ? 'bg-[#FF5315] text-white' : 'bg-white text-ink-900',
                          )}
                          style={{ left: r.x, top: r.y, width: r.w, height: r.h, lineHeight: `${r.h}px` }}
                        >
                          {partName(q)}
                        </button>
                      );
                    })}
                  </>
                )}
              </div>
            </div>
          );
        })}
        <span className="flex-none" style={{ width: spacer, height: 1 }} />
      </div>

      <div className={cn('flex h-4 flex-none items-center justify-center gap-1.5 [@media(max-height:699px)]:hidden', inPart && 'invisible')}>
        {WEEK_LOGO_PLACEMENTS.map(p => (
          <i key={p} className={cn('h-1.5 rounded-full transition-all', centred === p ? 'w-[18px] bg-white' : 'w-1.5 bg-white/35')} />
        ))}
      </div>

      <div className={cn(
        'mt-2 flex-none px-4 pb-[max(16px,env(safe-area-inset-bottom))]',
        editing && 'rounded-t-3xl bg-[#10132b] pt-3.5',
      )}>
        {editing && (
          <div
            ref={panelRef}
            data-share-panel
            onScroll={checkMore}
            style={more ? { maskImage: 'linear-gradient(to bottom, #000 80%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, #000 80%, transparent)' } : undefined}
            className="h-[124px] overflow-y-auto [scrollbar-width:none] [@media(min-height:700px)_and_(max-height:799px)]:h-[150px] [@media(min-height:800px)]:h-[178px] [&::-webkit-scrollbar]:hidden"
          >
            {tray}
          </div>
        )}
        {notice && <p className="mb-1.5 text-center text-2xs text-white/70">{notice}</p>}
        {error && <p className="mb-1.5 text-center text-2xs text-accent-red">{error}</p>}
        <button
          onClick={handleShare}
          disabled={rendering || busy || !previewUrl}
          className={cn(
            'mt-2 flex min-h-[50px] w-full items-center [@media(max-height:699px)]:min-h-[44px] justify-center gap-2 rounded-2xl text-base font-extrabold transition-all active:scale-[0.98]',
            rendering || busy || !previewUrl ? 'bg-white/10 text-white/40' : 'bg-brand-600 text-white',
          )}
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Share2 className="h-5 w-5" />}
          {t('action')}
        </button>
      </div>

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
    </div>,
    document.body,
  );
}
