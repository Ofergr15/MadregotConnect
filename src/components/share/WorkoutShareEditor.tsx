'use client';

import { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Share2, ImagePlus, Loader2, RotateCcw, Pencil, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import {
  renderShareCard, shareCard, supportsPhoto, supportsShoe, supportsTransparent,
  ACCENT_HEX, SHARE_ACCENT_KEYS, SHARE_BRAND_KEYS, STORY_H, STORY_W,
  type ShareAccent, type ShareBrand, type ShareTemplate,
} from '@/lib/feed/share-image';
import { SHARE_CARD_LANGS, WORKOUT_CARD_TEXT, type ShareCardLang } from '@/lib/share/card-text';
import { localizeDefaultName } from '@/lib/share/default-name';
import { partAt, placeLabels, type ShareBox, type ShareHitMap, type SharePart } from '@/lib/share/hit-map';
import {
  asWorkoutMetrics, canHrLine, canSegment, defaultChipKeys, defaultTemplate, drawnTemplate, fitChipKeys,
  fixedNumbersReason, frameCapacity, shareChips, shareFilename, shareTemplates, supportsAccent, toggleChip, viewBrand,
  type ShareSubject,
} from '@/lib/share/sheet-model';
import type { FeedItem } from '@/lib/feed/project';
import { fetchActivityDetails } from '@/lib/activities-client';
import type { HrTrace } from '@/lib/share/hr-trace';

/**
 * THE WORKOUT SHARE EDITOR: THE CARD IS THE CONTROL PANEL.
 *
 * The sheet it replaces put a small preview on top of three tabs of controls, and
 * the athlete had to guess which tab held "average line" and scroll away from the
 * card to change anything (feedback 2026-09-29). Here the card fills the screen:
 *
 *  · the six views are a carousel — swipe, or tap a look in the strip under it;
 *  · the card shows clean, as it will be shared, with only Share under it; Edit (or
 *    a tap on any part) brings up the looks and outlines and labels every part on
 *    the card, each label a button that swaps the strip for that part's options,
 *    and Done puts all of it away again;
 *  · there is no row of tabs as well: the labels already name the parts, and
 *    three ways to open the same options were two too many (feedback
 *    2026-09-29). Inside a part, "All looks" (or its label again) goes back;
 *  · the big bottom button always shares, from whichever tab is open.
 *
 * Where each part sits is read off the drawing (`lib/share/hit-map.ts`), so the tap
 * areas follow the card when a view moves its parts around.
 *
 * The rules of what can be shown where are the old sheet's, from
 * `lib/share/sheet-model.ts`, unchanged. The week card keeps the old sheet: its
 * renderer has no parts to tap.
 */
type WorkoutBackground = 'photo' | 'club' | 'sticker';
type Mode = 'looks' | SharePart | 'background';

const BRAND_SRC: Record<ShareBrand, string> = {
  badge: '/images/logo-white.png',
  wordmark: '/images/wordmark-white.png',
  stairs: '/images/stairs-white.png',
};

const VIEW_LABEL: Partial<Record<ShareTemplate, string>> = {
  splits: 'viewSplits',
  route: 'viewRoute',
  statsBar: 'viewStatsBar',
  classic: 'viewClassic',
  card: 'viewCard',
  minimal: 'viewMinimal',
};

/** The labels over the card: one line of 10px type in a pill. */
const LABEL_H = 20;
/** How far, in card pixels, an outline stands off the part it rings. */
const OUTLINE_PAD = 14;
function labelWidth(text: string): number {
  return Math.round(text.length * 6.4 + 18);
}

function cardItem(item: FeedItem, title: string): FeedItem {
  if (!item.activity || item.activity.activityName === title) return item;
  return { ...item, activity: { ...item.activity, activityName: title.trim() } };
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className="mb-2 flex min-h-[44px] w-full items-center justify-between rounded-xl bg-white/[0.08] px-3 text-sm font-bold text-white"
    >
      {label}
      <span className={cn('relative h-6 w-10 rounded-full transition-colors', on ? 'bg-[#FF5315]' : 'bg-white/25')}>
        <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', on ? 'end-0.5' : 'start-0.5')} />
      </span>
    </button>
  );
}

function Segmented<T extends string>({ items, value, onChange }: {
  items: Array<[T, string]>; value: T; onChange: (v: T) => void;
}) {
  return (
    <div className="mb-2 flex rounded-full bg-white/[0.08] p-0.5">
      {items.map(([k, label]) => (
        <button
          key={k}
          onClick={() => onChange(k)}
          aria-pressed={value === k}
          className={cn(
            'min-h-[40px] flex-1 rounded-full px-3 text-xs font-bold transition-colors',
            value === k ? 'bg-white text-ink-900' : 'text-white/60',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function WorkoutShareEditor({ item: given, onClose }: { item: FeedItem; onClose: () => void }) {
  // The watch's heart rate, for the lap chart, fetched for the run's own athlete
  // (the route answers nobody else). Until it comes, or when there is none, the
  // chart draws the laps' averages.
  const [hrTrace, setHrTrace] = useState<HrTrace | null>(null);
  const hrWanted = canHrLine({ kind: 'workout', item: given });
  const givenId = given.activity?.id;
  useEffect(() => {
    if (!hrWanted || !givenId) return;
    let cancelled = false;
    fetchActivityDetails(givenId, null, 'hr')
      .then(r => (r.ok ? r.json() : null))
      .then((body: { hrTrace?: HrTrace } | null) => {
        if (!cancelled && body?.hrTrace && body.hrTrace.length >= 10) setHrTrace(body.hrTrace);
      })
      .catch(() => { /* the laps' averages stand in */ });
    return () => { cancelled = true; };
  }, [hrWanted, givenId]);
  const item = useMemo<FeedItem>(
    () => (hrTrace && given.activity ? { ...given, activity: { ...given.activity, hrTrace } } : given),
    [given, hrTrace],
  );
  const t = useTranslations('shareSheet');
  const tc = useTranslations('common');
  const locale = useLocale();
  const rtl = locale !== 'en';
  const subject = useMemo<ShareSubject>(() => ({ kind: 'workout', item }), [item]);

  const views = useMemo(() => shareTemplates(subject).filter(v => v.available && VIEW_LABEL[v.key]), [subject]);
  const [template, setTemplate] = useState<ShareTemplate>(() => defaultTemplate(subject));
  const [keys, setKeys] = useState<string[]>(() => defaultChipKeys(subject, defaultTemplate(subject)));
  const [cardLang, setCardLang] = useState<ShareCardLang>(rtl ? 'he' : 'en');
  const [showTitle, setShowTitle] = useState(true);
  const [showStartTime, setShowStartTime] = useState(false);
  const [showDate, setShowDate] = useState(true);
  const [showShoe, setShowShoe] = useState(true);
  const originalTitle = item.activity?.activityName ?? '';
  const [typedTitle, setTypedTitle] = useState<string | null>(null);
  const [routeOnly, setRouteOnly] = useState(false);
  const [bg, setBg] = useState<WorkoutBackground>('club');
  const [accent, setAccent] = useState<ShareAccent>('white');
  const [brand, setBrand] = useState<ShareBrand | null>(null);
  const segmentOk = canSegment(subject);
  const [splitMode, setSplitMode] = useState<'km' | 'segments'>(() => (canSegment(subject) ? 'segments' : 'km'));
  const [avgLine, setAvgLine] = useState(true);
  const hrOk = canHrLine(subject);
  const [hrLine, setHrLine] = useState(true);
  const [photo, setPhoto] = useState<File | null>(null);

  const [mode, setMode] = useState<Mode>('looks');
  // The labels over the card show only while editing, so the card can be seen the
  // way it will be shared (feedback 2026-09-29).
  const [editing, setEditing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [hitMap, setHitMap] = useState<ShareHitMap>({});
  const [slideUrls, setSlideUrls] = useState<Partial<Record<ShareTemplate, string>>>({});
  const [thumbs, setThumbs] = useState<Partial<Record<ShareTemplate, string>>>({});
  const [rendering, setRendering] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const blobRef = useRef<Blob | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [mounted, setMounted] = useState(false);

  const i18n = WORKOUT_CARD_TEXT[cardLang];
  const titleText = typedTitle ?? localizeDefaultName(originalTitle, cardLang);
  const drawn = drawnTemplate(template, { routeOnly, withPhoto: bg === 'photo' && !!photo });
  const chips = useMemo(() => shareChips(subject, i18n, cardLang), [subject, i18n, cardLang]);
  const capacity = frameCapacity(subject, drawn);
  const fixed = fixedNumbersReason(subject, drawn);
  const full = !fixed && keys.length >= capacity;
  // The splits chart and the route keep their own options when their numbers are
  // fixed (km or splits, the average line; route with or without numbers), so their
  // tab stays. Hiding it on 'fixed' alone locked them out, and "route only" had no
  // way back.
  const dataOk = !fixed || template === 'splits' || template === 'route';
  const transparent = bg === 'sticker' && supportsTransparent(drawn);
  const accentOk = supportsAccent(subject, drawn);
  const photoOk = bg === 'photo' && supportsPhoto(drawn);
  // 'minimal' has never drawn a title, so it offers none to edit.
  const titleOk = !!originalTitle && template !== 'minimal';
  const dateOk = template === 'splits';
  const startOk = template === 'classic' || template === 'card';
  const shownBrand = brand ?? viewBrand(template);
  const inPart = mode !== 'looks';

  useEffect(() => {
    setMounted(true);
    // The card is the whole screen; the feed under it must not scroll along.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pickTemplate = useCallback((next: ShareTemplate) => {
    setTemplate(next);
    setBrand(null);
    setMode('looks');
    setHitMap({});
    setKeys(prev => fitChipKeys(subject, next, prev));
  }, [subject]);

  const openPart = useCallback((next: Mode) => {
    if (next !== 'looks') setEditing(true);
    setMode(next);
  }, []);
  const back = useCallback(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    setMode('looks');
  }, []);

  // Every picture on screen is a blob URL. One is let go only when its replacement
  // is handed over, never when a re-render starts: the old picture is still showing
  // then, and a revoked URL under a live <img> is a broken image.
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

  // The strip: each view once, with the opening choices.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const v of views) {
        try {
          const blob = await renderShareCard(item, WORKOUT_CARD_TEXT[rtl ? 'he' : 'en'], {
            template: v.key,
            metrics: asWorkoutMetrics(defaultChipKeys(subject, v.key)),
            splitMode: canSegment(subject) ? 'segments' : 'km',
            avgLine: true,
            hrLine: true,
            editorChart: true,
          });
          if (cancelled) return;
          const url = swapUrl(`thumb:${v.key}`, URL.createObjectURL(blob));
          setThumbs(prev => ({ ...prev, [v.key]: url }));
        } catch {
          // A missing thumbnail leaves the label; the view itself still works.
        }
      }
    })();
    return () => { cancelled = true; };
  }, [item, subject, views, rtl, swapUrl]);

  const renderOpts = useCallback((view: ShareTemplate, own: boolean) => {
    const d = drawnTemplate(view, { routeOnly, withPhoto: bg === 'photo' && !!photo });
    return {
      background: bg === 'photo' && supportsPhoto(d) ? photo : null,
      transparent: bg === 'sticker' && supportsTransparent(d),
      template: d,
      accent,
      showTitle: showTitle && titleText.trim().length > 0,
      showStartTime: (view === 'classic' || view === 'card') && showStartTime,
      showDate,
      showShoe,
      // A neighbour shows the logo it will have when swiped to: its own.
      brand: own ? brand ?? undefined : undefined,
      splitMode: segmentOk ? splitMode : 'km' as const,
      avgLine,
      hrLine,
      editorChart: true,
      metrics: asWorkoutMetrics(own ? keys : fitChipKeys(subject, view, keys)),
    };
  }, [routeOnly, bg, photo, accent, showTitle, titleText, showStartTime, showDate, showShoe, brand, segmentOk, splitMode, avgLine, hrLine, keys, subject]);

  // The card being edited, with its tap areas.
  useEffect(() => {
    let cancelled = false;
    setRendering(true);
    setError(null);
    setNotice(null);
    renderShareCard(cardItem(item, titleText), i18n, {
      ...renderOpts(template, true),
      onHitMap: map => { if (!cancelled) setHitMap(map); },
    })
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
  }, [item, titleText, i18n, template, renderOpts, swapUrl, t]);

  // The neighbours, once the card itself is up: nearest first, so the one a swipe
  // reaches is the one that is ready. They are what a swipe will land on, so they
  // carry the same language, background and title as the card being edited.
  useEffect(() => {
    if (rendering) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const at = views.findIndex(v => v.key === template);
      const order = views.filter(v => v.key !== template)
        .sort((a, b) => Math.abs(views.indexOf(a) - at) - Math.abs(views.indexOf(b) - at));
      for (const v of order) {
        try {
          const blob = await renderShareCard(cardItem(item, titleText), i18n, renderOpts(v.key, false));
          if (cancelled) return;
          const url = swapUrl(`slide:${v.key}`, URL.createObjectURL(blob));
          setSlideUrls(prev => ({ ...prev, [v.key]: url }));
        } catch { /* the strip's thumbnail stands in */ }
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [rendering, views, template, item, titleText, i18n, renderOpts, swapUrl]);

  // ── Carousel geometry ──────────────────────────────────────────────────────
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

  const [centred, setCentred] = useState<ShareTemplate>(template);
  const settleRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dragRef = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const justDragged = useRef(false);

  const centredView = useCallback((): ShareTemplate | null => {
    const el = stageRef.current;
    if (!el) return null;
    const mid = el.getBoundingClientRect().left + el.clientWidth / 2;
    let best: ShareTemplate | null = null, d = Infinity;
    el.querySelectorAll<HTMLElement>('[data-view]').forEach(s => {
      const r = s.getBoundingClientRect();
      const dd = Math.abs(r.left + r.width / 2 - mid);
      if (dd < d) { d = dd; best = s.dataset.view as ShareTemplate; }
    });
    return best;
  }, []);

  const scrollTo = useCallback((v: ShareTemplate, smooth = true) => {
    stageRef.current?.querySelector<HTMLElement>(`[data-view="${v}"]`)
      ?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', inline: 'center', block: 'nearest' });
  }, []);

  // A pick from the strip brings the card in; a swipe that settled on it already has.
  useEffect(() => {
    if (!slideW) return;
    if (centredView() !== template) scrollTo(template, centred === template);
    setCentred(template);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only the view and the geometry move the carousel
  }, [template, slideW]);

  const onScroll = () => {
    const c = centredView();
    if (c) setCentred(c);
    clearTimeout(settleRef.current);
    settleRef.current = setTimeout(() => {
      const v = centredView();
      if (!dragRef.current && v && v !== template) pickTemplate(v);
    }, 140);
  };

  // Touch and trackpads scroll natively; a mouse drags.
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
      const v = centredView();
      if (v) { scrollTo(v); if (v !== template) pickTemplate(v); }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [centredView, scrollTo, pickTemplate, template]);

  // A tap on a neighbour brings it in; on the card it opens the part under the
  // finger; inside a part, anywhere on the card goes back.
  const onSlideClick = (v: ShareTemplate, e: React.MouseEvent) => {
    if (justDragged.current) return;
    if (v !== template) { pickTemplate(v); return; }
    const r = imgRef.current?.getBoundingClientRect();
    if (!r) return;
    const part = partAt(hitMap, ((e.clientX - r.left) / r.width) * STORY_W, ((e.clientY - r.top) / r.height) * STORY_H);
    if (part === 'data' && !dataOk) { setNotice(t(fixed!)); return; }
    openPart(part);
  };

  const handleShare = async () => {
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
  };

  // ── The part outlines over the card ─────────────────────────────────────────
  const scale = slideW / STORY_W;
  const partName = (p: Mode): string => {
    if (p === 'logo') return accentOk ? t('partLogoAccent') : t('logoTitle');
    if (p === 'text') return t('tabText');
    if (p === 'background') return t('backgroundTitle');
    if (p === 'data') return template === 'splits' ? t('partChart') : template === 'route' ? t('viewRoute') : t('frameNumbers');
    return t('titleWorkout');
  };
  // A panel taller than its box fades at the bottom, so a small phone shows there is more.
  const panelRef = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const checkMore = () => {
    const el = panelRef.current;
    setMore(!!el && el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  };
  useLayoutEffect(checkMore);

  const labelName = (p: Mode): string => {
    if (p === 'logo') return t('logoTitle');
    return partName(p);
  };
  const outline = (p: SharePart, box: ShareBox, on: boolean, piece = 0) => {
    const pad = OUTLINE_PAD;
    return (
      <div
        key={`${p}-${piece}`}
        className={cn('pointer-events-none absolute rounded-[10px]', on
          ? 'border-[2.5px] border-[#FF5315] shadow-[0_0_0_999px_rgba(5,6,18,0.5),0_0_0_5px_rgba(255,83,21,0.3)]'
          : 'border-[1.5px] border-dashed border-white/80')}
        style={{
          left: (box.x0 - pad) * scale, top: (box.y0 - pad) * scale,
          width: (box.x1 - box.x0 + 2 * pad) * scale, height: (box.y1 - box.y0 + 2 * pad) * scale,
        }}
      />
    );
  };

  // The labels over the card. The route card's logo is a wordmark and a shoe with
  // the numbers between them, so its label goes on the bigger piece.
  const labelled = (['logo', 'text', 'data'] as const).filter(p => hitMap[p] && (p !== 'data' || dataOk));
  const labelBox = (p: SharePart): ShareBox => {
    const pieces = p === 'logo' ? hitMap.logoPieces : undefined;
    if (!pieces?.length) return hitMap[p]!;
    return pieces.reduce((a, b) => ((b.x1 - b.x0) * (b.y1 - b.y0) > (a.x1 - a.x0) * (a.y1 - a.y0) ? b : a));
  };
  const toScreen = (b: ShareBox) => ({
    x: (b.x0 - OUTLINE_PAD) * scale, y: (b.y0 - OUTLINE_PAD) * scale,
    w: (b.x1 - b.x0 + 2 * OUTLINE_PAD) * scale, h: (b.y1 - b.y0 + 2 * OUTLINE_PAD) * scale,
  });
  const labels = placeLabels(
    [
      ...labelled.map(p => {
        const b = labelBox(p);
        return {
          key: p,
          box: toScreen(b),
          w: labelWidth(labelName(p)),
        };
      }),
      // The background's label sits on the card's bottom edge.
      { key: 'background', box: { x: 6, y: slideH - 6 - 26, w: slideW - 12, h: 26 }, w: labelWidth(labelName('background')) },
    ],
    { w: slideW, h: slideH },
    // Every piece of the logo is in the way of the other labels, not just the one
    // its own label sits on.
    { h: LABEL_H, gap: 6, rtl, obstacles: (hitMap.logoPieces ?? []).map(toScreen) },
  );

  const photoView = supportsPhoto(drawnTemplate(template, { routeOnly, withPhoto: true }));
  const stickerView = supportsTransparent(drawnTemplate(template, { routeOnly }));

  // ── Dragging the picked numbers into the order the card prints them ─────────
  // Pointer events rather than HTML drag-and-drop, which iOS Safari does not give
  // a finger. A press that moves less than a few pixels is still a tap (remove).
  const pickedRef = useRef<HTMLDivElement>(null);
  const [draggingChip, setDraggingChip] = useState<string | null>(null);
  const chipDragged = useRef(false);
  const startChipDrag = (key: string, e: React.PointerEvent) => {
    const x0 = e.clientX, y0 = e.clientY;
    chipDragged.current = false;
    const move = (ev: PointerEvent) => {
      if (!chipDragged.current && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      chipDragged.current = true;
      setDraggingChip(key);
      const over = pickedRef.current
        ? [...pickedRef.current.querySelectorAll<HTMLElement>('[data-chip]')].find(el => {
          const r = el.getBoundingClientRect();
          return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
        })
        : undefined;
      const target = over?.dataset.chip;
      if (target && target !== key) {
        setKeys(prev => {
          const next = prev.filter(k => k !== key);
          next.splice(prev.indexOf(target), 0, key);
          return next;
        });
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setDraggingChip(null);
      // The click that follows the release must not also remove the chip.
      setTimeout(() => { chipDragged.current = false; }, 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  // ── The tray: the looks, or the options of the part that was tapped ──────────
  const tray = (() => {
    if (mode === 'data' && template === 'splits') {
      return (
        <>
          {segmentOk && (
            <Segmented
              items={[['km', t('splitKm')], ['segments', t('splitSegments')]]}
              value={splitMode}
              onChange={setSplitMode}
            />
          )}
          <Toggle label={t('avgLine')} on={avgLine} onClick={() => setAvgLine(v => !v)} />
          {hrOk && splitMode === 'segments' && (
            <Toggle label={t('hrLine')} on={hrLine} onClick={() => setHrLine(v => !v)} />
          )}
        </>
      );
    }
    if (mode === 'data') {
      return (
        <>
          {template === 'route' && (
            <Segmented
              items={[['stats', t('routeWithStats')], ['only', t('viewRouteOnly')]]}
              value={routeOnly ? 'only' : 'stats'}
              onChange={v => {
                const only = v === 'only';
                setRouteOnly(only);
                setKeys(prev => fitChipKeys(subject, only ? 'routeOnly' : 'route', prev));
              }}
            />
          )}
          {!fixed && (
            <>
              {/* Every number is its own tile, as in the sheet: the picked ones first, in the
                  order the card prints them (left to right in both languages, like the card),
                  and those can be dragged; a tap turns any tile on or off. */}
              <div ref={pickedRef} className="grid grid-cols-4 gap-1.5" dir="ltr">
                {[...keys.map(k => chips.find(c => c.key === k)).filter(c => !!c), ...chips.filter(c => !keys.includes(c.key))].map(chip => {
                  const on = keys.includes(chip.key);
                  const blocked = !on && full;
                  return (
                    <button
                      key={chip.key}
                      data-chip={on ? chip.key : undefined}
                      onPointerDown={on ? e => startChipDrag(chip.key, e) : undefined}
                      onClick={() => { if (!chipDragged.current) setKeys(prev => toggleChip(prev, chip.key, capacity)); }}
                      disabled={blocked}
                      aria-pressed={on}
                      className={cn(
                        'min-h-[44px] min-w-0 rounded-xl px-2 py-0.5 text-start transition-transform',
                        on ? 'touch-none bg-[#FF5315] text-white' : blocked ? 'bg-white/[0.05] text-white/30' : 'bg-white/[0.08] text-white/85',
                        draggingChip === chip.key && 'z-10 scale-105 shadow-lg ring-2 ring-white',
                      )}
                    >
                      <span className="block truncate text-3xs font-medium leading-tight opacity-80">{chip.label}</span>
                      {/* Laid out as the card draws it: the Hebrew unit to the left of the number,
                          the English one to the right, each piece left-to-right so "/km" keeps its slash in front. */}
                      <span dir="ltr" className={cn('flex gap-1 truncate text-xs font-bold leading-tight', cardLang === 'en' ? 'justify-start' : 'flex-row-reverse justify-end')}>
                        <bdi dir="ltr">{chip.value}</bdi>
                        {chip.unit && <bdi dir="ltr">{chip.unit}</bdi>}
                      </span>
                    </button>
                  );
                })}
              </div>
              {keys.length > 1 && <p className="mt-1 text-center text-3xs text-white/45">{t('dragHint')}</p>}
              {full && chips.length > capacity && (
                <p className="mt-0.5 text-center text-3xs text-white/45" dir="auto">{t('contentFull', { count: capacity })}</p>
              )}
            </>
          )}
          {fixed && <p className="mt-1 text-center text-2xs text-white/55" dir="auto">{t(fixed)}</p>}
        </>
      );
    }
    if (mode === 'logo') {
      return (
        <>
          <div className="flex gap-2">
            {SHARE_BRAND_KEYS.map(b => (
              <button
                key={b}
                onClick={() => setBrand(b)}
                aria-pressed={shownBrand === b}
                aria-label={t(b === 'badge' ? 'brandBadge' : b === 'wordmark' ? 'brandWordmark' : 'brandStairs')}
                className={cn(
                  'flex h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl border-2 bg-white/[0.08]',
                  shownBrand === b ? 'border-[#FF5315]' : 'border-transparent',
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={BRAND_SRC[b]} alt="" className="max-h-7 max-w-[78%] object-contain" />
                {b === viewBrand(template) && <span className="text-3xs font-bold text-white/55">{t('brandOwn')}</span>}
              </button>
            ))}
          </div>
          {supportsShoe(drawn) && (
            <div className="mt-2">
              <Toggle label={t('showShoe')} on={showShoe} onClick={() => setShowShoe(v => !v)} />
            </div>
          )}
          {accentOk && (
            <div className="mt-3 flex items-center gap-3">
              <span className="text-xs font-bold text-white/55">{t('accentTitle')}</span>
              {SHARE_ACCENT_KEYS.map(a => (
                <button
                  key={a}
                  onClick={() => setAccent(a)}
                  aria-pressed={accent === a}
                  aria-label={t(a === 'white' ? 'accentWhite' : 'accentOrange')}
                  className="grid h-11 w-11 place-items-center"
                >
                  <span
                    className={cn('h-8 w-8 rounded-full', accent === a && 'shadow-[0_0_0_2px_#10132b,0_0_0_4px_#FF5315]')}
                    style={{ backgroundColor: ACCENT_HEX[a] }}
                  />
                </button>
              ))}
            </div>
          )}
        </>
      );
    }
    if (mode === 'text') {
      const chip = (label: string, on: boolean, onClick: () => void) => (
        <button
          key={label}
          onClick={onClick}
          aria-pressed={on}
          className={cn('min-h-[40px] rounded-full px-3.5 text-xs font-bold', on ? 'bg-[#FF5315] text-white' : 'bg-white/[0.08] text-white/80')}
        >
          {label}
        </button>
      );
      return (
        <>
          {titleOk && (
            <div className="mb-2 flex items-center gap-1 rounded-xl bg-white px-3">
              <input
                value={titleText}
                onChange={e => setTypedTitle(e.target.value.slice(0, 60))}
                onKeyDown={e => { if (e.key === 'Enter') back(); }}
                enterKeyHint="done"
                aria-label={t('titleEdit')}
                placeholder={t('titleEdit')}
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
          )}
          {/* The language shares the row with the chips: on a small phone a row of its
              own pushed it below the fold. */}
          <div className="flex flex-wrap items-center gap-1.5">
            {titleOk && chip(t('partTitle'), showTitle, () => setShowTitle(v => !v))}
            {dateOk && chip(t('partDate'), showDate, () => setShowDate(v => !v))}
            {startOk && chip(t('partStart'), showStartTime, () => setShowStartTime(v => !v))}
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
      const opt = (key: WorkoutBackground, label: string, swatch: string, ok: boolean) => {
        const on = bg === key && (key !== 'photo' || !!photo);
        return (
          <button
            key={key}
            disabled={!ok}
            aria-pressed={on}
            onClick={() => {
              // No photo yet: the picker, and choosing a file is what switches it.
              if (key === 'photo' && (!photo || bg === 'photo')) fileRef.current?.click();
              else setBg(key);
            }}
            className={cn(
              'flex h-[76px] flex-1 flex-col items-center justify-center gap-1.5 rounded-xl border-2 bg-white/[0.08] text-2xs font-bold text-white',
              on ? 'border-[#FF5315]' : 'border-transparent',
              !ok && 'opacity-30',
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
        <>
          <div className="flex gap-2">
            {opt('club', t('bgClub'), 'bg-gradient-to-br from-[#1525FF] to-[#0a0f5c]', true)}
            {opt('photo', photo && bg === 'photo' ? t('changePhoto') : t('bgPhoto'), 'bg-white/15', photoView)}
            {opt('sticker', t('sticker'), 'bg-[repeating-conic-gradient(#555_0_25%,#999_0_50%)] bg-[length:10px_10px]', stickerView)}
          </div>
          {!photoView && <p className="mt-2 text-center text-2xs text-white/55">{t('noPhotoView')}</p>}
          {transparent && <p className="mt-2 text-center text-2xs leading-relaxed text-white/55">{t('stickerHint')}</p>}
        </>
      );
    }
    // The looks. All six fit across, no scrolling rail: a rail hides whatever is
    // past its edge, which is how seven views once went missing.
    return (
      <>
        <div className="flex gap-1.5">
          {views.map(v => {
            const on = template === v.key;
            return (
              <button
                key={v.key}
                onClick={() => pickTemplate(v.key)}
                aria-pressed={on}
                className={cn('min-w-0 flex-1 text-center', on ? 'text-white' : 'text-white/55')}
              >
                <span
                  className={cn('block w-full overflow-hidden rounded-lg border-2 bg-white/[0.08]', on ? 'border-[#FF5315]' : 'border-transparent')}
                  style={{ aspectRatio: '9 / 16' }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {thumbs[v.key] && <img src={thumbs[v.key]} alt="" className="h-full w-full object-cover" />}
                </span>
                <span className="mt-1 block truncate text-3xs font-bold">{t(VIEW_LABEL[v.key]!)}</span>
              </button>
            );
          })}
        </div>
      </>
    );
  })();

  if (!mounted) return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('titleWorkout')}
      dir={rtl ? 'rtl' : 'ltr'}
      className="fixed inset-0 z-[310] flex select-none flex-col bg-[#0b0d1d] pt-[env(safe-area-inset-top)] text-white"
    >
      <div className="relative flex h-14 flex-none items-center justify-between px-3 [@media(max-height:699px)]:h-11">
        <button
          onClick={onClose}
          aria-label={tc('close')}
          className="grid min-h-[44px] min-w-[44px] place-items-center rounded-lg text-white/85"
        >
          <X className="h-5 w-5" />
        </button>
        {/* Centred on the screen, not between two buttons of different widths. */}
        <span className="pointer-events-none absolute inset-x-24 truncate text-center text-base font-extrabold">{inPart ? partName(mode) : t('titleWorkout')}</span>
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
        className={cn(
          'flex min-h-0 flex-1 items-center overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          inPart ? 'overflow-x-hidden' : 'snap-x snap-mandatory overflow-x-auto',
        )}
        style={{ gap: GAP }}
      >
        <span className="flex-none" style={{ width: spacer, height: 1 }} />
        {views.map(v => {
          const own = v.key === template;
          const src = own ? previewUrl : slideUrls[v.key] ?? thumbs[v.key];
          return (
            <div
              key={v.key}
              data-view={v.key}
              onClick={e => onSlideClick(v.key, e)}
              className={cn(
                'relative flex-none snap-center snap-always cursor-pointer transition-[transform,opacity] duration-200',
                centred === v.key ? 'opacity-100' : 'scale-90 opacity-45',
              )}
              style={{ width: slideW, height: slideH }}
            >
              <div
                className="relative h-full w-full overflow-hidden rounded-2xl bg-white/[0.06] shadow-[0_8px_30px_rgba(0,0,0,0.5)]"
                style={own && transparent ? {
                  background: 'repeating-conic-gradient(#2a2e48 0 25%, #1b1f36 0 50%) 0 0 / 18px 18px',
                } : undefined}
              >
                {src && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    ref={own ? imgRef : undefined}
                    src={src}
                    alt={own ? t('preview') : t(VIEW_LABEL[v.key]!)}
                    draggable={false}
                    className="pointer-events-none h-full w-full"
                  />
                )}
                {own && rendering && (
                  <Loader2 className="absolute start-2.5 top-2.5 h-5 w-5 animate-spin text-white/70" />
                )}
                {own && !rendering && (
                  <>
                    {editing && labelled.filter(p => p !== mode).flatMap(p => (
                      p === 'logo' && hitMap.logoPieces ? hitMap.logoPieces.map((b, i) => outline(p, b, false, i)) : [outline(p, hitMap[p]!, false)]
                    ))}
                    {inPart && mode !== 'background' && hitMap[mode] && (
                      mode === 'logo' && hitMap.logoPieces
                        ? hitMap.logoPieces.map((b, i) => outline('logo', b, true, i))
                        : outline(mode, hitMap[mode]!, true)
                    )}
                    {mode === 'background' && (
                      <div className="pointer-events-none absolute inset-1.5 rounded-xl border-[2.5px] border-[#FF5315]" />
                    )}
                    {/* The labels are buttons, over everything, so a part drawn small (the
                        logo) still has a target it can be opened from. */}
                    {editing && [...labelled, 'background' as const].map(p => {
                      const r = labels[p];
                      if (!r) return null;
                      const on = mode === p;
                      return (
                        <button
                          key={`label-${p}`}
                          type="button"
                          aria-pressed={on}
                          onClick={e => { e.stopPropagation(); if (on) back(); else openPart(p); }}
                          className={cn(
                            'absolute whitespace-nowrap rounded-full text-center text-3xs font-extrabold shadow-[0_2px_6px_rgba(0,0,0,0.45)] transition-colors',
                            // The pill is drawn small; its target is not.
                            "after:absolute after:-inset-x-1 after:-inset-y-1.5 after:content-['']",
                            on ? 'bg-[#FF5315] text-white' : 'bg-white text-ink-900',
                          )}
                          style={{ left: r.x, top: r.y, width: r.w, height: r.h, lineHeight: `${r.h}px` }}
                        >
                          {labelName(p)}
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
        {views.map(v => (
          <i key={v.key} className={cn('h-1.5 rounded-full transition-all', centred === v.key ? 'w-[18px] bg-white' : 'w-1.5 bg-white/35')} />
        ))}
      </div>

      {/* The looks and the part options come up only while editing; Done puts them
          away and the card takes the room back (feedback 2026-09-29). */}
      <div className={cn(
        'mt-2 flex-none px-4 pb-[max(16px,env(safe-area-inset-bottom))]',
        editing && 'rounded-t-3xl bg-[#10132b] pt-3.5',
      )}>
        {editing && (
          <>
            {/* Its row is kept on the looks too, so opening a part does not shrink the card
                under the finger. */}
            <button
              type="button"
              onClick={back}
              tabIndex={inPart ? undefined : -1}
              aria-hidden={!inPart || undefined}
              className={cn(
                '-ms-1 mb-1 flex min-h-[32px] items-center gap-0.5 rounded-lg px-1 text-xs font-extrabold text-white/75',
                !inPart && 'invisible',
              )}
            >
              {rtl ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
              {t('allLooks')}
            </button>
            <div
              ref={panelRef}
              data-share-panel
                            onScroll={checkMore}
              style={more ? { maskImage: 'linear-gradient(to bottom, #000 80%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, #000 80%, transparent)' } : undefined}
              className="h-[124px] overflow-y-auto [scrollbar-width:none] [@media(min-height:700px)_and_(max-height:799px)]:h-[150px] [@media(min-height:800px)]:h-[178px] [&::-webkit-scrollbar]:hidden"
            >
              {tray}
            </div>
          </>
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
