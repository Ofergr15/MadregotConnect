'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Share2, Loader2, ImagePlus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { SHARE_BRAND_KEYS, shareCard, type ShareBrand } from '@/lib/feed/share-image';
import type { Last7Report, WellnessNight } from '@/lib/reports/last-7-days';
import {
  LOOK_BRAND, LOOK_CAP, NUMBER_ORDER, WEEK_BACKGROUNDS, WEEK_STORY_TEXT,
  availableLooks, availableNumbers, initialStoryState, numberValue, swapNumbers, toggleNumber,
  type WeekBackground, type WeekLook, type WeekNumberKey, type WeekStoryState,
} from '@/lib/reports/week-story';
import { BRAND_SRC, renderWeekStory } from '@/lib/reports/week-story-image';

/**
 * THE WEEKLY STORY EDITOR — version C of the approved mockup.
 *
 * The card fills the screen and is the picture that will be posted (the preview
 * IS the rendered file). Under it, one row of options and a bar of tabs: look,
 * numbers, logo, text, chart (the day-by-day look only) and background. Swiping
 * the card sideways changes the look.
 *
 * Super user only while it is tried out (ShareSheet decides); everyone else keeps
 * the old weekly sheet.
 */
type Tab = 'looks' | 'numbers' | 'logo' | 'text' | 'chart' | 'background';

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
  const [tab, setTab] = useState<Tab>('looks');
  const [photo, setPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Partial<Record<WeekLook, string>>>({});
  const [rendering, setRendering] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const blobRef = useRef<Blob | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const text = WEEK_STORY_TEXT[state.lang];
  const cap = LOOK_CAP[state.look];
  const picks = state.picks[state.look];
  const set = useCallback((patch: Partial<WeekStoryState>) => setState(s => ({ ...s, ...patch })), []);

  useEffect(() => {
    setMounted(true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  // The chart tab belongs to one look; leaving that look leaves the tab.
  useEffect(() => { if (tab === 'chart' && state.look !== 'days') setTab('numbers'); }, [tab, state.look]);

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

  useEffect(() => {
    let cancelled = false;
    setRendering(true);
    const timer = setTimeout(async () => {
      try {
        const blob = await renderWeekStory(input);
        if (cancelled) return;
        blobRef.current = blob;
        setPreviewUrl(swapUrl('preview', blob));
      } catch {
        if (!cancelled) setNotice(ts('shareError'));
      } finally {
        if (!cancelled) setRendering(false);
      }
    }, 80);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [input, swapUrl, ts]);

  // The looks strip, drawn only while it is showing.
  useEffect(() => {
    if (tab !== 'looks') return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      for (const look of looks) {
        try {
          const blob = await renderWeekStory({ ...input, look });
          if (cancelled) return;
          const url = swapUrl(`thumb-${look}`, blob);
          setThumbs(prev => ({ ...prev, [look]: url }));
        } catch {}
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [tab, looks, input, swapUrl]);

  const stepLook = (dir: 1 | -1) => {
    const i = looks.indexOf(state.look);
    const next = looks[i + dir];
    if (next) set({ look: next });
  };

  // Swipe on the card: a sideways drag of 40px changes the look. In RTL the
  // next look is to the left, where a Hebrew reader's "next" is.
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const onCardDown = (e: React.PointerEvent) => { swipe.current = { x: e.clientX, y: e.clientY }; };
  const onCardUp = (e: React.PointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(e.clientY - s.y)) return;
    const forward = rtl ? dx > 0 : dx < 0;
    stepLook(forward ? 1 : -1);
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
    setNotice(null);
    try {
      const sticker = state.background === 'sticker';
      const result = await shareCard(blob, `madregot-week-${report.to}.${sticker ? 'png' : 'jpg'}`);
      if (result === 'downloaded') setNotice(sticker ? ts('savedSticker') : ts('saved'));
    } catch {
      setNotice(ts('shareError'));
    } finally {
      setBusy(false);
    }
  };

  const pill = (on: boolean, label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'min-h-[36px] rounded-full px-3.5 text-xs font-extrabold transition-colors',
        on ? 'bg-white text-ink-900' : 'bg-white/[0.1] text-white/80',
      )}
    >
      {label}
    </button>
  );

  const tabs: { key: Tab; label: string }[] = [
    { key: 'looks', label: t('tabLooks') },
    { key: 'numbers', label: t('tabNumbers') },
    { key: 'logo', label: t('tabLogo') },
    { key: 'text', label: t('tabText') },
    ...(state.look === 'days' ? [{ key: 'chart' as const, label: t('tabChart') }] : []),
    { key: 'background', label: t('tabBackground') },
  ];

  const row = (() => {
    if (tab === 'looks') {
      return (
        <div className="flex gap-2">
          {looks.map(look => {
            const on = state.look === look;
            return (
              <button key={look} type="button" onClick={() => set({ look })} aria-pressed={on} className={cn('min-w-0 flex-1 text-center', on ? 'text-white' : 'text-white/55')}>
                <span className={cn('mx-auto block w-full max-w-[64px] overflow-hidden rounded-lg border-2 bg-white/[0.08]', on ? 'border-[#FF5315]' : 'border-transparent')} style={{ aspectRatio: '9 / 16' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {thumbs[look] && <img src={thumbs[look]} alt="" className="h-full w-full object-cover" />}
                </span>
                <span className="mt-1 block truncate text-3xs font-bold">{text.looks[look]}</span>
              </button>
            );
          })}
        </div>
      );
    }
    if (tab === 'numbers') {
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
          <p className="mt-1.5 text-center text-3xs text-white/55">
            {full && avail.length > cap ? `${t('numbersFull', { cap })} · ` : ''}{t('numbersHint')}
          </p>
        </>
      );
    }
    if (tab === 'logo') {
      const shown = state.brand ?? LOOK_BRAND[state.look];
      return (
        <div className="flex gap-2">
          {SHARE_BRAND_KEYS.map((b: ShareBrand) => (
            <button
              key={b}
              type="button"
              onClick={() => set({ brand: b === LOOK_BRAND[state.look] ? null : b })}
              aria-pressed={shown === b}
              aria-label={b === 'badge' ? t('brandBadge') : b === 'stairs' ? t('brandStairs') : 'MADREGOT'}
              className={cn('relative grid h-16 flex-1 place-items-center rounded-xl border-2 bg-white/[0.06]', shown === b ? 'border-[#FF5315]' : 'border-transparent')}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={BRAND_SRC[b]} alt="" className={b === 'wordmark' ? 'h-4' : 'h-9'} />
              {b === LOOK_BRAND[state.look] && <span className="absolute bottom-0.5 text-[9px] text-white/55">{t('ownLogo')}</span>}
            </button>
          ))}
        </div>
      );
    }
    if (tab === 'text') {
      return (
        <>
          <input
            value={state.title}
            maxLength={24}
            placeholder={t('titlePlaceholder')}
            onChange={e => set({ title: e.target.value })}
            className="h-10 w-full rounded-xl border border-white/15 bg-white/[0.08] px-3 text-base font-bold text-white outline-none placeholder:text-white/35"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {text.titles.filter(x => x !== state.title).slice(0, 3).map(x => pill(false, x, () => set({ title: x })))}
            {pill(state.dates, t('dates'), () => set({ dates: !state.dates }))}
            {pill(state.name, t('name'), () => set({ name: !state.name }))}
            {pill(state.lang === 'en', state.lang === 'en' ? 'EN' : 'עב', () => {
              const lang = state.lang === 'he' ? 'en' : 'he';
              const titles = WEEK_STORY_TEXT[state.lang].titles;
              const i = titles.indexOf(state.title);
              // A preset title follows the language; a typed one is the athlete's and stays.
              set({ lang, title: i >= 0 ? WEEK_STORY_TEXT[lang].titles[i] : state.title });
            })}
          </div>
        </>
      );
    }
    if (tab === 'chart') {
      return (
        <>
          <div className="flex gap-1 rounded-full bg-white/[0.08] p-1">
            {(['km', 'time'] as const).map(m => (
              <button key={m} type="button" onClick={() => set({ chartMetric: m })} aria-pressed={state.chartMetric === m} className={cn('min-h-[34px] flex-1 rounded-full text-xs font-extrabold', state.chartMetric === m ? 'bg-white text-ink-900' : 'text-white/75')}>
                {m === 'km' ? t('chartKm') : t('chartTime')}
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {nights?.length ? pill(state.sleepStrip, t('sleepStrip'), () => set({ sleepStrip: !state.sleepStrip })) : null}
            {pill(state.avgLine, t('avgLine'), () => set({ avgLine: !state.avgLine }))}
            {pill(state.barValues, t('barValues'), () => set({ barValues: !state.barValues }))}
          </div>
        </>
      );
    }
    return (
      <div className="flex gap-2">
        {WEEK_BACKGROUNDS.map(b => (
          <button
            key={b}
            type="button"
            onClick={() => { if (b === 'photo' && !photo) fileRef.current?.click(); set({ background: b }); }}
            aria-pressed={state.background === b}
            className={cn('min-w-0 flex-1 text-center', state.background === b ? 'text-white' : 'text-white/60')}
          >
            <i className={cn('mx-auto grid h-12 w-12 place-items-center rounded-xl border-2', state.background === b ? 'border-[#FF5315]' : 'border-white/15')} style={{ background: BG_SWATCH[b] }}>
              {b === 'photo' && <ImagePlus className="h-4 w-4 text-white/85" />}
            </i>
            <span className="mt-1 block truncate text-3xs font-bold">{t(BG_LABEL[b])}</span>
          </button>
        ))}
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
        <button onClick={onClose} aria-label={tc('close')} className="grid min-h-[44px] min-w-[44px] place-items-center rounded-lg text-white/85">
          <X className="h-5 w-5" />
        </button>
        <span className="pointer-events-none absolute inset-x-20 text-center">
          <span className="block truncate text-base font-extrabold">{t('title')}</span>
          <span className="block text-3xs font-bold text-[#FF8A5B]">{t('trial')}</span>
        </span>
        <span className="w-11" />
      </div>

      <div
        onPointerDown={onCardDown}
        onPointerUp={onCardUp}
        className="flex min-h-0 flex-1 touch-pan-y items-center justify-center px-6"
      >
        <div
          className="relative h-full max-h-full overflow-hidden rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.5)]"
          style={{
            aspectRatio: '9 / 16',
            background: state.background === 'sticker'
              ? 'repeating-conic-gradient(#2a2e48 0 25%, #1b1f36 0 50%) 0 0 / 18px 18px'
              : 'rgba(255,255,255,0.06)',
          }}
        >
          {previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt={ts('preview')} draggable={false} className="pointer-events-none h-full w-full" />
          )}
          {rendering && <Loader2 className="absolute start-2.5 top-2.5 h-5 w-5 animate-spin text-white/70" />}
        </div>
      </div>

      <div className="flex h-5 flex-none items-center justify-center gap-1.5">
        {looks.map(l => (
          <i key={l} className={cn('h-1.5 rounded-full transition-all', state.look === l ? 'w-[18px] bg-white' : 'w-1.5 bg-white/35')} />
        ))}
        <span className="ms-2 text-3xs text-white/45">{text.looks[state.look]} · {t('swipeHint')}</span>
      </div>

      <div className="mt-1 flex-none rounded-t-3xl bg-[#10132b] px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-3">
        <div className="h-[132px] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{row}</div>
        <div className="mt-1 flex gap-1 border-t border-white/10 pt-1.5">
          {tabs.map(x => (
            <button
              key={x.key}
              type="button"
              onClick={() => setTab(x.key)}
              aria-pressed={tab === x.key}
              className={cn('min-h-[36px] flex-1 rounded-lg text-2xs font-extrabold', tab === x.key ? 'bg-white/[0.12] text-white' : 'text-white/55')}
            >
              {x.label}
            </button>
          ))}
        </div>
        {notice && <p className="mt-1.5 text-center text-2xs text-white/70">{notice}</p>}
        <button
          onClick={handleShare}
          disabled={rendering || busy || !previewUrl}
          className={cn(
            'mt-2 flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl text-base font-extrabold transition-all active:scale-[0.98] [@media(max-height:699px)]:min-h-[44px]',
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
