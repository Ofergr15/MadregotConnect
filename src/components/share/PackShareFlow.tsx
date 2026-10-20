'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Download, ImagePlus, Loader2, RefreshCw, Share2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { WorkoutShareEditor } from '@/components/share/WorkoutShareEditor';
import { fetchFeedItemByActivity } from '@/lib/feed-client';
import { withoutHeartRate, type FeedItem } from '@/lib/feed/project';
import { renderShareCard, shareCard } from '@/lib/feed/share-image';
import { WORKOUT_CARD_TEXT } from '@/lib/share/card-text';
import { shareFilename } from '@/lib/share/sheet-model';
import { fitLook, loadLook, lookFits, lookRenderOptions, saveLook, type WorkoutLook } from '@/lib/share/workout-look';

/**
 * ONE LOOK, EVERY PACK (Ofer 2026-10-20, mockups/post-session/v2).
 *
 * The quality (or long-run) morning's share, without making the card three times:
 *  1. the share editor opens on pack 1's runner, titled as the pack, and the look is
 *     picked there exactly as for any run; its bar says "להחיל על N הדבוקות";
 *  2. the same look is drawn on every pack's runner (`renderShareCard` with the
 *     look's options, fitted to each run — `fitLook`), side by side;
 *  3. a pack's runner can be swapped, the look stays; then the cards go out one
 *     after another ("1 מתוך 3"), or all are saved at once.
 * The last look is remembered (localStorage), so the next morning starts from it.
 */

export interface PackRunner { id: string; name: string; km: number; paceSec: number | null }
export interface PackChoice { pack: number; title: string; runners: PackRunner[]; chosen: string }

const pace = (s: number | null) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');
const first = (n: string) => n.split(' ')[0] || n;

async function loadItem(id: string, title: string): Promise<FeedItem> {
  const { item } = await fetchFeedItemByActivity(id);
  if (!item?.activity) throw new Error('no activity');
  // As the single share does: the runner's own card, heart rate out, titled as the pack.
  const bare = withoutHeartRate(item);
  return { ...bare, activity: { ...bare.activity!, activityName: title } };
}

type Photos = { mode: 'same'; file: File } | { mode: 'each'; files: Record<number, File | null> } | null;

export function PackShareFlow({ packs: given, onClose, onShared }: {
  packs: PackChoice[];
  onClose: () => void;
  /** A pack's card went out (shared or saved). */
  onShared?: (pack: number) => void;
}) {
  const [packs, setPacks] = useState(given);
  const [items, setItems] = useState<Record<string, FeedItem>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const [look, setLook] = useState<WorkoutLook | null>(null);
  const [photos, setPhotos] = useState<Photos>(null);
  const [askPhoto, setAskPhoto] = useState<File | null>(null);
  const [cards, setCards] = useState<Record<number, { url: string; blob: Blob; fits: boolean }>>({});
  const [swap, setSwap] = useState<number | null>(null);
  const [next, setNext] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const keyOf = (p: PackChoice) => `${p.pack}:${p.chosen}`;
  // Each pack's chosen run, as a feed item; fetched once per runner.
  useEffect(() => {
    let cancelled = false;
    for (const p of packs) {
      const k = keyOf(p);
      if (items[k]) continue;
      loadItem(p.chosen, p.title)
        .then(it => { if (!cancelled) setItems(prev => ({ ...prev, [k]: it })); })
        .catch(() => { if (!cancelled) setFailed(p.title); });
    }
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- items is what this fills
  }, [packs]);

  const firstItem = items[keyOf(packs[0])];
  const opening = useMemo(() => loadLook(), []);

  // Step 2: the same look on every pack's run.
  const photoFor = useCallback((pack: number): File | null => {
    if (!photos) return null;
    return photos.mode === 'same' ? photos.file : photos.files[pack] ?? null;
  }, [photos]);
  useEffect(() => {
    if (!look) return;
    let cancelled = false;
    (async () => {
      for (const p of packs) {
        const it = items[keyOf(p)];
        if (!it) continue;
        const subject = { kind: 'workout' as const, item: it };
        const fitted = fitLook(look, subject);
        try {
          const blob = await renderShareCard(it, WORKOUT_CARD_TEXT[fitted.cardLang], lookRenderOptions(fitted, subject, { photo: photoFor(p.pack), titleText: p.title }));
          if (cancelled) return;
          setCards(prev => {
            if (prev[p.pack]) setTimeout(() => URL.revokeObjectURL(prev[p.pack].url), 1000);
            return { ...prev, [p.pack]: { url: URL.createObjectURL(blob), blob, fits: lookFits(look, subject) } };
          });
        } catch { /* the pack shows its loader; the others still go */ }
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-drawn when the look, a runner or a photo changes
  }, [look, items, packs, photos]);

  const apply = (l: WorkoutLook, photo: File | null) => {
    saveLook(l);
    if (photo) setAskPhoto(photo); else setPhotos(null);
    setLook(l);
  };

  const ready = packs.every(p => cards[p.pack]);
  const shareNext = async () => {
    const p = packs[next];
    const c = p && cards[p.pack];
    if (!c || busy) return;
    setBusy(true);
    try {
      const it = items[keyOf(p)];
      const out = await shareCard(c.blob, shareFilename({ kind: 'workout', item: it }, c.blob.type === 'image/png'));
      if (out !== 'cancelled') {
        onShared?.(p.pack);
        setNext(n => Math.min(n + 1, packs.length));
      }
    } finally { setBusy(false); }
  };
  const saveAll = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const files = packs.map(p => {
        const c = cards[p.pack];
        return new File([c.blob], `madregot-pack-${p.pack}.${c.blob.type === 'image/png' ? 'png' : 'jpg'}`, { type: c.blob.type || 'image/jpeg' });
      });
      let done = false;
      if (navigator.canShare?.({ files })) {
        try { await navigator.share({ files }); done = true; } catch (e) { if ((e as Error)?.name === 'AbortError') return; }
      }
      if (!done) for (const [i, f] of files.entries()) await shareCard(f, files[i].name);
      packs.forEach(p => onShared?.(p.pack));
      setNotice(`נשמרו ${packs.length} תמונות`);
    } finally { setBusy(false); }
  };

  if (!mounted) return null;

  // Step 1: the editor on pack 1.
  if (!look) {
    if (!firstItem) {
      return createPortal(
        <div className="fixed inset-0 z-[310] grid place-items-center bg-[#0b0d1d] text-white" dir="rtl">
          {failed ? <div className="text-center"><p>לא הצלחתי לפתוח את הריצה של {failed}</p><button className="mt-3 font-bold text-[#9AA0FF]" onClick={onClose}>סגירה</button></div> : <Loader2 className="h-6 w-6 animate-spin" />}
        </div>, document.body);
    }
    return <WorkoutShareEditor item={firstItem} onClose={onClose} initialLook={opening} applyAll={{ count: packs.length, onApply: apply }} />;
  }

  const swapPack = swap != null ? packs.find(p => p.pack === swap) : null;
  return createPortal(
    <div className="fixed inset-0 z-[310] flex flex-col bg-[#0b0d1d] pt-[env(safe-area-inset-top)] text-white" dir="rtl">
      <div className="flex items-center justify-between px-5 pt-4">
        <button aria-label="סגירה" onClick={onClose} className="grid h-10 w-10 place-items-center"><X className="h-6 w-6" /></button>
        <b className="text-[17px]">{packs.length} הדבוקות · אותו מראה</b>
        <button onClick={() => { setLook(null); setCards({}); setNext(0); }} className="min-h-10 px-2 text-14 font-bold text-white/60">למראה</button>
      </div>
      <p className="mt-1 text-center text-13 text-white/55">כל כרטיס עם הריצה והמספרים של הרץ מהדבוקה</p>

      <div className="mt-5 flex justify-center gap-2.5 px-3">
        {packs.map((p, i) => {
          const c = cards[p.pack];
          const runner = p.runners.find(r => r.id === p.chosen);
          return (
            <div key={p.pack} className="flex w-[112px] min-w-0 flex-col items-center">
              <div className={cn('relative aspect-[9/16] w-full overflow-hidden rounded-xl bg-white/[0.06] shadow-[0_8px_24px_rgba(0,0,0,.5)]', next > i && 'ring-2 ring-[#34C759]')}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {c ? <img src={c.url} alt="" className="h-full w-full object-cover" /> : <Loader2 className="absolute inset-0 m-auto h-5 w-5 animate-spin text-white/50" />}
                {c && !c.fits && <span className="absolute inset-x-1 bottom-1 rounded-md bg-black/70 px-1 py-0.5 text-center text-[10px] font-bold">בלי GPS · מראה אחר</span>}
                {next > i && <Check className="absolute end-1 top-1 h-5 w-5 rounded-full bg-[#34C759] p-0.5" />}
              </div>
              <b className="mt-2 text-13">{p.title.split(' · ')[0]}</b>
              <small className="max-w-full truncate text-12 text-white/60">{runner ? first(runner.name) : ''}</small>
              <div className="mt-1 flex items-center gap-2">
                {p.runners.length > 1 && (
                  <button onClick={() => setSwap(p.pack)} className="flex min-h-9 items-center gap-1 text-12 font-bold text-[#9AA0FF]"><RefreshCw className="h-3 w-3" /> החלפה</button>
                )}
                {photos?.mode === 'each' && (
                  <label className="flex min-h-9 cursor-pointer items-center gap-1 text-12 font-bold text-[#9AA0FF]">
                    <ImagePlus className="h-3.5 w-3.5" /> תמונה
                    <input type="file" accept="image/*" className="hidden" onChange={e => {
                      const f = e.target.files?.[0] ?? null;
                      setPhotos(prev => (prev?.mode === 'each' ? { mode: 'each', files: { ...prev.files, [p.pack]: f } } : prev));
                    }} />
                  </label>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-auto space-y-2 px-4 pb-[max(24px,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-2 rounded-2xl bg-white/[0.07] px-3 py-2.5 text-13 text-white/75"><Check className="h-4 w-4 text-[#34C759]" /> המראה נשמר — בפעם הבאה מתחילים ממנו</div>
        {notice && <p className="text-center text-12 text-white/70">{notice}</p>}
        <button onClick={shareNext} disabled={!ready || busy || next >= packs.length}
          className={cn('flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl text-base font-extrabold', !ready || next >= packs.length ? 'bg-white/10 text-white/40' : 'bg-brand-600')}>
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Share2 className="h-5 w-5" />}
          {next >= packs.length ? 'כל הדבוקות שותפו' : <>שיתוף לסטורי · <bdi dir="ltr">{next + 1}</bdi> מתוך <bdi dir="ltr">{packs.length}</bdi></>}
        </button>
        <button onClick={saveAll} disabled={!ready || busy}
          className={cn('flex min-h-[46px] w-full items-center justify-center gap-2 rounded-2xl text-[15px] font-extrabold', ready ? 'bg-white/10' : 'bg-white/5 text-white/40')}>
          <Download className="h-5 w-5" /> שמירת {packs.length} התמונות
        </button>
      </div>

      {askPhoto && (
        <>
          <div className="fixed inset-0 bg-black/55" onClick={() => { setPhotos({ mode: 'same', file: askPhoto }); setAskPhoto(null); }} />
          <div className="fixed inset-x-0 bottom-0 rounded-t-[22px] bg-[#16192e] px-4 pb-8 pt-2">
            <div className="mx-auto mb-3 h-[5px] w-10 rounded-full bg-white/25" />
            <b className="block text-[18px]">התמונה ברקע</b>
            <small className="block text-13 text-white/55">לבחור פעם אחת, או תמונה לכל דבוקה</small>
            <button onClick={() => { setPhotos({ mode: 'same', file: askPhoto }); setAskPhoto(null); }} className="mt-3 flex min-h-[50px] w-full items-center justify-center rounded-2xl bg-brand-600 font-extrabold">אותה תמונה לכולם</button>
            <button onClick={() => { setPhotos({ mode: 'each', files: { [packs[0].pack]: askPhoto } }); setAskPhoto(null); }} className="mt-2 flex min-h-[46px] w-full items-center justify-center rounded-2xl bg-white/10 font-extrabold">תמונה לכל דבוקה</button>
          </div>
        </>
      )}

      {swapPack && (
        <>
          <div className="fixed inset-0 bg-black/55" onClick={() => setSwap(null)} />
          <div className="fixed inset-x-0 bottom-0 max-h-[75vh] overflow-y-auto rounded-t-[22px] bg-[#16192e] px-4 pb-8 pt-2">
            <div className="mx-auto mb-3 h-[5px] w-10 rounded-full bg-white/25" />
            <b className="block text-[18px]">{swapPack.title.split(' · ')[0]} · מי בכרטיס?</b>
            <small className="block text-13 text-white/55">המראה נשאר — רק הנתונים מתחלפים</small>
            <div className="mt-3 overflow-hidden rounded-2xl bg-white/[0.06]">
              {swapPack.runners.map((r, i) => (
                <button key={r.id} onClick={() => { setPacks(ps => ps.map(p => (p.pack === swapPack.pack ? { ...p, chosen: r.id } : p))); setSwap(null); }}
                  className={cn('flex min-h-[52px] w-full items-center gap-2.5 px-3 text-start', i && 'border-t border-white/[0.06]')}>
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-600 text-[11px] font-extrabold">{r.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</span>
                  <span className="min-w-0 flex-1"><b className="block truncate text-[14px]">{r.name}</b><small className="text-12 text-white/55"><bdi dir="ltr">{r.km.toFixed(1)}</bdi> ק״מ{r.paceSec ? <> · <bdi dir="ltr">{pace(r.paceSec)}</bdi></> : null}</small></span>
                  {r.id === swapPack.chosen && <Check className="h-5 w-5 text-[#34C759]" />}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}
