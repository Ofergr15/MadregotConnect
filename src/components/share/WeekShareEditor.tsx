'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Share2, Loader2, ImagePlus, Pencil, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { SHARE_BRAND_KEYS, STORY_H, STORY_W, shareCard, type ShareBrand } from '@/lib/feed/share-image';
import type { Last7Report, WellnessNight } from '@/lib/reports/last-7-days';
import {
  LOOK_BRAND, LOOK_CAP, NUMBER_ORDER, WEEK_BACKGROUNDS, WEEK_STORY_TEXT,
  availableLooks, availableNumbers, initialStoryState, numberValue, swapNumbers, toggleNumber,
  type WeekBackground, type WeekLook, type WeekNumberKey, type WeekStoryState,
} from '@/lib/reports/week-story';
import { BRAND_SRC, renderWeekStory } from '@/lib/reports/week-story-image';
import { partAt, placeLabels, type ShareBox, type ShareHitMap, type SharePart } from '@/lib/share/hit-map';
import { LABEL_H, OUTLINE_PAD, Segmented, Toggle, labelWidth } from '@/components/share/editor-parts';

/**
 * THE WEEKLY STORY EDITOR, IN THE WORKOUT EDITOR'S FLOW.
 *
 * What the week offers is version C of the approved mockup (`week-story.ts`): five
 * looks, a numbers tray in one fixed order with per-look picks and drag-to-swap,
 * the logo, the text, the day-by-day chart's options and five backgrounds.
 *
 * How it is edited is `WorkoutShareEditor`'s, because "the weekly summary has to
 * work with the same editing as the workout share" (feedback 2026-09-30): the card
 * fills the screen and the looks are a carousel; Edit (or a tap on the card)
 * labels every part on it; a label opens that part's options; "‹ Edit" or a tap
 * beside the card goes back; the big button always shares. The two files are kept
 * in step by hand, and what they draw with is shared (`editor-parts.tsx`).
 *
 * The parts are the workout's three plus the background: logo, text (title,
 * dates, name, card language), numbers (the tray, and on the day-by-day look the
 * chart's options under it) and background.
 *
 * Super user only while it is tried out (ShareSheet decides); everyone else keeps
 * the old weekly sheet.
 */
type Mode = 'looks' | SharePart | 'background';

const BG_SWATCH: Record<WeekBackground, string> = {
  club: 'linear-gradient(160deg,#2f45ff,#1b1150)',
  sunset: 'linear-gradient(160deg,#FF8A3D,#8a1f3d)',
  night: 'linear-gradient(160deg,#23263a,#0b0d1d)',
  photo: 'linear-gradient(135deg,#7aa0b8,#c9b48a 38%,#6f8f5e 62%,#3b4f3a)',
  sticker: 'repeating-conic-gradient(#3a3d52 0% 25%,#2a2d40 0% 50%) 50%/12px 12px',
};
const BG_LABEL: Record<WeekBackground, string> = {
  club: 'bgClub', sunset: 'bgSunset', night: 'bgNight', photo: 'bgPhoto', sticker: 'bgSticker',
};
const CHECKER = 'repeating-conic-gradient(#2a2e48 0 25%, #1b1f36 0 50%) 0 0 / 18px 18px';

export interface WeekShareEditorProps {
  report: Last7Report;
  previous?: Last7Report | null;
  nights?: WellnessNight[];
  athleteName: string | null;
  onClose: () => void;
}

export function WeekShareEditor({ report, previous, nights, athleteName, onClose }: WeekShareEditorProps) {
  const t = useTranslations('weekEditor');
  const ts = useTranslations('shareSheet');
  const tc = useTranslations('common');
  const locale = useLocale();
  const rtl = locale !== 'en';

  const looks = useMemo(() => availableLooks(report), [report]);
  const avail = useMemo(() => availableNumbers(report), [report]);
  const [state, setState] = useState<WeekStoryState>(() => initialStoryState(report, rtl ? 'he' : 'en'));
  const [photo, setPhoto] = useState<File | null>(null);
  const [mode, setMode] = useState<Mode>('looks');
  const [editing, setEditing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [hitMap, setHitMap] = useState<ShareHitMap>({});
  const [slideUrls, setSlideUrls] = useState<Partial<Record<WeekLook, string>>>({});
  const [rendering, setRendering] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const blobRef = useRef<Blob | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const text = WEEK_STORY_TEXT[state.lang];
  const look = state.look;
  const cap = LOOK_CAP[look];
  const picks = state.picks[look];
  const inPart = mode !== 'looks';
  const set = useCallback((patch: Partial<WeekStoryState>) => setState(s => ({ ...s, ...patch })), []);

  useEffect(() => {
    setMounted(true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const pickLook = useCallback((next: WeekLook) => {
    setState(s => ({ ...s, look: next }));
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

  // One URL per slot, let go only once its replacement is on screen.
  const live = useRef(new Map<string, string>());
  const swapUrl = useCallback((slot: string, blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const old = live.current.get(slot);
    live.current.set(slot, url);
    if (old) setTimeout(() => URL.revokeObjectURL(old), 1000);
    return url;
  }, []);
  useEffect(() => {
    const urls = live.current;
    return () => { urls.forEach(u => URL.revokeObjectURL(u)); urls.clear(); };
  }, []);

  const input = useMemo(
    () => ({ report, previous, nights, athleteName, photo, state }),
    [report, previous, nights, athleteName, photo, state],
  );

  // The card being edited, with its tap areas.
  useEffect(() => {
    let cancelled = false;
    setRendering(true);
    setError(null);
    const timer = setTimeout(async () => {
      try {
        const blob = await renderWeekStory({ ...input, onHitMap: map => { if (!cancelled) setHitMap(map); } });
        if (cancelled) return;
        blobRef.current = blob;
        setPreviewUrl(swapUrl('preview', blob));
      } catch {
        if (!cancelled) setError(ts('renderError'));
      } finally {
        if (!cancelled) setRendering(false);
      }
    }, 80);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [input, swapUrl, ts]);

  // The other looks, once the card is up, with the same choices, so a swipe lands on one ready.
  useEffect(() => {
    if (rendering) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      for (const l of looks.filter(l => l !== look)) {
        try {
          const blob = await renderWeekStory({ ...input, look: l });
          if (cancelled) return;
          const url = swapUrl(`slide:${l}`, blob);
          setSlideUrls(prev => ({ ...prev, [l]: url }));
        } catch { /* the slide stays blank until it is picked */ }
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [rendering, look, looks, input, swapUrl]);

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

  const [centred, setCentred] = useState<WeekLook>(look);
  const settleRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dragRef = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const justDragged = useRef(false);

  const centredLook = useCallback((): WeekLook | null => {
    const el = stageRef.current;
    if (!el) return null;
    const mid = el.getBoundingClientRect().left + el.clientWidth / 2;
    let best: WeekLook | null = null, d = Infinity;
    el.querySelectorAll<HTMLElement>('[data-view]').forEach(s => {
      const r = s.getBoundingClientRect();
      const dd = Math.abs(r.left + r.width / 2 - mid);
      if (dd < d) { d = dd; best = s.dataset.view as WeekLook; }
    });
    return best;
  }, []);
  const scrollTo = useCallback((v: WeekLook, smooth = true) => {
    stageRef.current?.querySelector<HTMLElement>(`[data-view="${v}"]`)
      ?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', inline: 'center', block: 'nearest' });
  }, []);
  // The first placement jumps, and until it has, a scroll is the snap settling on
  // whatever it found before the layout, not a swipe: it must not pick a look.
  const placed = useRef(false);
  useEffect(() => {
    if (!slideW) return;
    if (centredLook() !== look) scrollTo(look, placed.current && centred === look);
    setCentred(look);
    requestAnimationFrame(() => { placed.current = true; });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only the look and the geometry move the carousel
  }, [look, slideW]);

  const onScroll = () => {
    if (!placed.current) return;
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

  const onSlideClick = (v: WeekLook, e: React.MouseEvent) => {
    if (justDragged.current) return;
    if (v !== look) { if (inPart) back(); else pickLook(v); return; }
    const r = imgRef.current?.getBoundingClientRect();
    if (!r) return;
    const part = partAt(hitMap, ((e.clientX - r.left) / r.width) * STORY_W, ((e.clientY - r.top) / r.height) * STORY_H);
    openPart(part);
  };

  // ── Numbers: tap toggles, drag one picked tile onto another to swap ────────
  const [dragKey, setDragKey] = useState<WeekNumberKey | null>(null);
  const [dropKey, setDropKey] = useState<WeekNumberKey | null>(null);
  const dragged = useRef(false);
  const startDrag = (key: WeekNumberKey, e: React.PointerEvent) => {
    if (!picks.includes(key)) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    dragged.current = false;
    let target: WeekNumberKey | null = null;
    const move = (ev: PointerEvent) => {
      if (!dragged.current && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      if (!dragged.current) { dragged.current = true; setDragKey(key); }
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-number-on]');
      const k = (el?.dataset.numberOn as WeekNumberKey | undefined) ?? null;
      target = k && k !== key ? k : null;
      setDropKey(target);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (dragged.current && target) {
        const to = target;
        setState(s => ({ ...s, picks: { ...s.picks, [s.look]: swapNumbers(s.picks[s.look], key, to) } }));
      }
      setDragKey(null);
      setDropKey(null);
      setTimeout(() => { dragged.current = false; }, 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  const tapNumber = (key: WeekNumberKey) => {
    if (dragged.current) return;
    setState(s => ({ ...s, picks: { ...s.picks, [s.look]: toggleNumber(s.picks[s.look], key, LOOK_CAP[s.look]) } }));
  };

  const handleShare = async () => {
    const blob = blobRef.current;
    if (!blob || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const sticker = state.background === 'sticker';
      const result = await shareCard(blob, `madregot-week-${report.to}.${sticker ? 'png' : 'jpg'}`);
      if (result === 'downloaded') setNotice(sticker ? ts('savedSticker') : ts('saved'));
      else onClose();
    } catch {
      setError(ts('shareError'));
    } finally {
      setBusy(false);
    }
  };

  // ── The part outlines and labels over the card ─────────────────────────────
  const scale = slideW / STORY_W;
  const partName = (p: Mode): string => {
    if (p === 'logo') return t('tabLogo');
    if (p === 'text') return t('tabText');
    if (p === 'background') return t('tabBackground');
    if (p === 'data') return look === 'days' ? `${t('tabNumbers')} · ${t('tabChart')}` : t('tabNumbers');
    return t('title');
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
      type="button"
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
      const full = picks.length >= cap;
      return (
        <>
          <div className="grid grid-cols-4 gap-1.5">
            {NUMBER_ORDER.filter(k => avail.includes(k)).map(k => {
              const place = picks.indexOf(k);
              const on = place >= 0;
              const blocked = !on && full;
              const health = k === 'sleep' || k === 'rhr';
              return (
                <button
                  key={k}
                  type="button"
                  data-number-on={on ? k : undefined}
                  onPointerDown={e => startDrag(k, e)}
                  onClick={() => tapNumber(k)}
                  aria-pressed={on}
                  className={cn(
                    'relative min-h-[48px] touch-none rounded-xl border-[1.5px] px-1 py-1.5 text-center transition-colors',
                    on ? 'border-[#FF5315] bg-[#FF5315]/20' : health ? 'border-[#B7ACFF]/40 bg-white/[0.06]' : 'border-white/15 bg-white/[0.06]',
                    blocked && 'opacity-40',
                    dragKey === k && 'opacity-60',
                    dropKey === k && 'outline outline-2 outline-dashed outline-white',
                  )}
                >
                  {on && (
                    <em className="absolute -top-1.5 start-1 grid h-4 min-w-4 place-items-center rounded-full bg-[#FF5315] px-1 text-[10px] font-extrabold not-italic text-white">
                      {place + 1}
                    </em>
                  )}
                  <span className="block truncate text-[10px] font-bold text-white/70">{text.labels[k]}</span>
                  <b className="block text-sm font-extrabold tabular-nums"><bdi dir="ltr">{numberValue(report, k)}</bdi></b>
                </button>
              );
            })}
          </div>
          <p className="mb-2 mt-1.5 text-center text-3xs text-white/55">
            {full && avail.length > cap ? `${t('numbersFull', { cap })} · ` : ''}{t('numbersHint')}
          </p>
          {look === 'days' && (
            <>
              <Segmented
                items={[['km', t('chartKm')], ['time', t('chartTime')]]}
                value={state.chartMetric}
                onChange={m => set({ chartMetric: m })}
              />
              {nights?.length ? <Toggle label={t('sleepStrip')} on={state.sleepStrip} onClick={() => set({ sleepStrip: !state.sleepStrip })} /> : null}
              <Toggle label={t('avgLine')} on={state.avgLine} onClick={() => set({ avgLine: !state.avgLine })} />
              <Toggle label={t('barValues')} on={state.barValues} onClick={() => set({ barValues: !state.barValues })} />
            </>
          )}
        </>
      );
    }
    if (mode === 'logo') {
      const shown = state.brand ?? LOOK_BRAND[look];
      return (
        <div className="flex gap-2">
          {SHARE_BRAND_KEYS.map((b: ShareBrand) => (
            <button
              key={b}
              type="button"
              onClick={() => set({ brand: b === LOOK_BRAND[look] ? null : b })}
              aria-pressed={shown === b}
              aria-label={b === 'badge' ? t('brandBadge') : b === 'stairs' ? t('brandStairs') : 'MADREGOT'}
              className={cn(
                'flex h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl border-2 bg-white/[0.08]',
                shown === b ? 'border-[#FF5315]' : 'border-transparent',
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={BRAND_SRC[b]} alt="" className="max-h-7 max-w-[78%] object-contain" />
              {b === LOOK_BRAND[look] && <span className="text-3xs font-bold text-white/55">{t('ownLogo')}</span>}
            </button>
          ))}
        </div>
      );
    }
    if (mode === 'text') {
      return (
        <>
          <input
            value={state.title}
            maxLength={24}
            placeholder={t('titlePlaceholder')}
            onChange={e => set({ title: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter') back(); }}
            enterKeyHint="done"
            dir="auto"
            className="mb-2 min-h-[44px] w-full rounded-xl bg-white px-3 text-sm font-bold text-ink-900 outline-none placeholder:text-ink-400"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            {text.titles.filter(x => x !== state.title).slice(0, 3).map(x => pill(x, false, () => set({ title: x })))}
            {pill(t('dates'), state.dates, () => set({ dates: !state.dates }))}
            {pill(t('name'), state.name, () => set({ name: !state.name }))}
            <div className="ms-auto flex rounded-full bg-white/[0.08] p-0.5">
              {(['he', 'en'] as const).map(l => (
                <button
                  key={l}
                  type="button"
                  onClick={() => {
                    if (l === state.lang) return;
                    const i = WEEK_STORY_TEXT[state.lang].titles.indexOf(state.title);
                    // A preset title follows the language; a typed one is the athlete's and stays.
                    set({ lang: l, title: i >= 0 ? WEEK_STORY_TEXT[l].titles[i] : state.title });
                  }}
                  aria-pressed={state.lang === l}
                  className={cn('min-h-[38px] rounded-full px-3 text-xs font-bold', state.lang === l ? 'bg-white text-ink-900' : 'text-white/60')}
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
      return (
        <div className="flex gap-2">
          {WEEK_BACKGROUNDS.map(b => {
            const on = state.background === b;
            return (
              <button
                key={b}
                type="button"
                onClick={() => {
                  if (b === 'photo' && (!photo || on)) fileRef.current?.click();
                  set({ background: b });
                }}
                aria-pressed={on}
                className={cn('min-w-0 flex-1 text-center', on ? 'text-white' : 'text-white/60')}
              >
                <i
                  className={cn('mx-auto grid h-12 w-12 place-items-center rounded-xl border-2', on ? 'border-[#FF5315]' : 'border-white/15')}
                  style={{ background: BG_SWATCH[b] }}
                >
                  {b === 'photo' && <ImagePlus className="h-4 w-4 text-white/85" />}
                </i>
                <span className="mt-1 block truncate text-3xs font-bold">{t(BG_LABEL[b])}</span>
              </button>
            );
          })}
        </div>
      );
    }
    // The looks, all of them on screen.
    return (
      <div className="flex gap-2">
        {looks.map(l => {
          const on = look === l;
          const src = on ? previewUrl : slideUrls[l];
          return (
            <button
              key={l}
              type="button"
              onClick={() => pickLook(l)}
              aria-pressed={on}
              className={cn('min-w-0 flex-1 text-center', on ? 'text-white' : 'text-white/55')}
            >
              <span
                className={cn('mx-auto block w-full max-w-[64px] overflow-hidden rounded-lg border-2 bg-white/[0.08]', on ? 'border-[#FF5315]' : 'border-transparent')}
                style={{ aspectRatio: '9 / 16' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {src && <img src={src} alt="" className="h-full w-full object-cover" />}
              </span>
              <span className="mt-1 block truncate text-3xs font-bold">{text.looks[l]}</span>
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
      aria-label={t('title')}
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
        <span className="pointer-events-none absolute inset-x-24 text-center">
          <span className="block truncate text-base font-extrabold">{inPart ? partName(mode) : t('title')}</span>
          {!inPart && <span className="block text-3xs font-bold text-[#FF8A5B]">{t('trial')}</span>}
        </span>
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
        {looks.map(l => {
          const own = l === look;
          const src = own ? previewUrl : slideUrls[l];
          return (
            <div
              key={l}
              data-view={l}
              onClick={e => onSlideClick(l, e)}
              className={cn(
                'relative flex-none snap-center snap-always cursor-pointer transition-[transform,opacity] duration-200',
                centred === l ? 'opacity-100' : 'scale-90 opacity-45',
              )}
              style={{ width: slideW, height: slideH }}
            >
              <div
                className="relative h-full w-full overflow-hidden rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.5)]"
                style={{ background: state.background === 'sticker' ? CHECKER : 'rgba(255,255,255,0.06)' }}
              >
                {src && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    ref={own ? imgRef : undefined}
                    src={src}
                    alt={own ? ts('preview') : text.looks[l]}
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
        {looks.map(l => (
          <i key={l} className={cn('h-1.5 rounded-full transition-all', centred === l ? 'w-[18px] bg-white' : 'w-1.5 bg-white/35')} />
        ))}
        <span className="ms-2 text-3xs text-white/45">{text.looks[centred]} · {t('swipeHint')}</span>
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
          {ts('action')}
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) { setPhoto(f); set({ background: 'photo' }); }
          e.target.value = '';
        }}
      />
    </div>,
    document.body,
  );
}
