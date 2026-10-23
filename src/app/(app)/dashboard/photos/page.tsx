'use client';

/**
 * תמונות — the club's photos from Drive (mockup ~/.cache/madregot/photos-module.html,
 * approved 2026-10-18). The home leads with the latest session, then every folder
 * by month; a search filters folders by name, day or month; a folder is a grid that
 * opens a full-screen viewer. `?folder=<id>` deep-links a folder (the feed's photos
 * card, a push).
 *
 * Data: GET /api/photos/browse and /api/photos/browse/folder (lib/photos/drive-browse.ts).
 * "My photos" (face matching) is not here: it needs the import + Rekognition pipeline,
 * which production has no AWS keys for. The old page with it is page.disabled.tsx.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { NAMES_KEY, PhotosLoading } from '@/components/photos/PhotosLoading';
import { ArrowRight, ImageOff, Search, X, MoreHorizontal, Play } from 'lucide-react';
import { preload } from 'swr';
import { apiFetcher, useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { sessionDayLabel } from '@/lib/quality-session/photos';
import { PhotoViewer } from '@/components/photos/PhotoViewer';
import { VideoViewer, type ViewerVideo } from '@/components/photos/VideoViewer';
import { FolderMenu, driveLink, savePhotos } from '@/components/photos/FolderMenu';
import { FOLDER_KINDS, KIND_LABEL, kindFromName, tagColor, type FolderKind } from '@/lib/photos/folder-kind';
import { useNavIdentity } from '@/lib/nav-items';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { textMatches } from '@/lib/search/match';

interface Folder {
  id: string; name: string; title: string | null; date: string; count: number; covers: string[]; coverBlur?: string | null; pinned?: boolean; hero?: string | null; kind?: FolderKind; tags?: string[];
  /** The folder's videos (mockup photos-videos, 2026-10-23). */
  videos?: number; videoMs?: number; videoCovers?: Array<{ id: string; ms: number | null; thumb: string | null }>;
}
/** הכל · תמונות · סרטונים — on the home and in a folder. */
type Media = 'all' | 'photos' | 'videos';
const dur = (ms?: number | null) => (ms ? `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}` : '');
/** "42 תמונות · 180 סרטונים" — what is in it, photos and videos apart. */
const mediaCount = (f: Pick<Folder, 'count' | 'videos'>) => [f.count ? `${f.count} תמונות` : '', f.videos ? `${f.videos} סרטונים` : ''].filter(Boolean).join(' · ') || '0 תמונות';
interface Browse { configured: boolean; folders: Folder[] }
interface FolderPhotos { folder: Folder; photos: Array<{ id: string; thumb: string | null; full: string | null; blur?: string | null; t?: string | null }>; videos?: Array<ViewerVideo & { ms: number | null; t?: string | null }> }

const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const monthKey = (date: string) => date.slice(0, 7);
const monthLabel = (key: string, thisYear: string) => {
  const [y, m] = key.split('-');
  return `${MONTHS[Number(m) - 1]}${y !== thisYear ? ` ${y}` : ''}`;
};

/**
 * The folder's title — its name with the date taken out (lib/photos/folder-names.ts),
 * or the day itself when the name was only a date.
 */
const folderTitle = (f: Folder) => f.title || sessionDayLabel(f.date);

/** "שישי 16.10 · 19 תמונות" — the day, unless the title already is the day. */
function subline(f: Folder, count: string): string {
  return f.title ? `${sessionDayLabel(f.date)} · ${count}` : count;
}

/**
 * One photo in a tile. `blur` is the copy's tiny inline preview (lib/photos/mirror.ts):
 * painted under the image at once, so the grid is never a wall of grey while the
 * photos arrive.
 */
function Cover({ src, blur, className }: { src?: string; blur?: string | null; className?: string }) {
  const bg = blur ? { backgroundImage: `url(${blur})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined;
  // Fades in over the preview instead of popping in. A photo already in the cache can
  // finish before React attaches onLoad, so `complete` is read on mount as well.
  const [loaded, setLoaded] = useState(false);
  const ref = useCallback((el: HTMLImageElement | null) => { if (el?.complete && el.naturalWidth) setLoaded(true); }, []);
  if (!src) return <div style={bg} className={cn('h-full w-full bg-page', className)} />;
  return (
    <div style={bg} className={cn('h-full w-full bg-page', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={ref} src={src} alt="" loading="lazy" decoding="async" draggable={false} onLoad={() => setLoaded(true)}
        className={cn('h-full w-full object-cover transition-opacity duration-300', loaded ? 'opacity-100' : 'opacity-0')} />
    </div>
  );
}

/** Start a folder's listing before the tap lands (a finger down is ~100 ms ahead of the click). */
const prefetchFolder = (id: string) => { preload(`/api/photos/browse/folder?id=${encodeURIComponent(id)}`, apiFetcher); };

/** Holding a finger down this long opens the folder's menu (FolderMenu) instead of the folder. */
const LONG_PRESS_MS = 480;
/**
 * A video tile's mark: its length beside a small drawn play glyph, bottom corner, on a
 * soft shade — the iPhone Photos way. The "▶" character it replaced drew as an emoji on iOS.
 */
function VideoBadge({ ms, small }: { ms?: number | null; small?: boolean }) {
  return (
    <>
      <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/55 to-transparent" />
      <span className={cn('absolute bottom-1.5 left-1.5 flex items-center gap-1 font-bold text-white drop-shadow', small ? 'text-[10.5px]' : 'text-[11.5px]')}>
        <Play className={small ? 'h-2.5 w-2.5' : 'h-3 w-3'} fill="currentColor" strokeWidth={0} />
        {ms ? <bdi dir="ltr">{dur(ms)}</bdi> : null}
      </span>
    </>
  );
}

/** הכל · תמונות · סרטונים, with how many of each. */
function MediaSeg({ value, onChange, photos, videos }: { value: Media; onChange: (m: Media) => void; photos: number; videos: number }) {
  const k = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}K` : String(n));
  const opts: Array<[Media, string, number | null]> = [['all', 'הכל', null], ['photos', 'תמונות', photos], ['videos', 'סרטונים', videos]];
  return (
    <div className="mx-4 mt-3 flex rounded-[12px] bg-[#E3E3E9] p-[2px]" role="tablist">
      {opts.map(([v, label, n]) => (
        <button key={v} type="button" role="tab" aria-selected={value === v} onClick={() => onChange(v)}
          className={cn('min-h-[38px] flex-1 rounded-[10px] text-[13.5px] font-bold', value === v ? 'bg-white text-ink-900 shadow-[0_2px_6px_rgba(0,0,0,0.08)]' : 'text-ink-500')}>
          {label}{n != null && <small className="ms-1 text-[11px] text-ink-400"><bdi dir="ltr">{k(n)}</bdi></small>}
        </button>
      ))}
    </div>
  );
}

/** "סרטונים": a row per session, newest first, its newest videos across (mockup photos-videos, 4). */
function VideoRows({ folders, onOpen, filters, filter, setFilter }: {
  folders: Folder[]; onOpen: (id: string) => void;
  filters: ReadonlyArray<readonly [string, string]>; filter: string; setFilter: (v: string) => void;
}) {
  return (
    <>
      {filters.length > 2 && (
        <div className="flex gap-1.5 overflow-x-auto px-4 pt-3 [scrollbar-width:none]" role="tablist">
          {filters.map(([v, label]) => (
            <button key={v} type="button" role="tab" aria-selected={filter === v} onClick={() => setFilter(v)}
              className={cn('min-h-[36px] shrink-0 rounded-full px-3.5 text-[13px] font-bold', filter === v ? 'bg-ink-900 text-white' : 'bg-card text-ink-500')}>{label}</button>
          ))}
        </div>
      )}
      {folders.slice(0, 40).map((f) => (
        <section key={f.id}>
          <button type="button" onClick={() => onOpen(f.id)} className="flex w-full items-baseline justify-between px-[18px] pb-2 pt-5 text-start">
            <b className="truncate text-[16.5px] font-extrabold text-ink-900" dir="auto">{folderTitle(f)}</b>
            <span className="shrink-0 text-[12.5px] text-ink-400"><bdi dir="ltr">{f.videos}</bdi> ›</span>
          </button>
          <div className="flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
            {(f.videoCovers ?? []).map((v) => (
              <button key={v.id} type="button" onClick={() => onOpen(f.id)} className="relative h-[124px] w-[84px] shrink-0 overflow-hidden rounded-[14px] bg-page" aria-label="סרטון">
                <Cover src={v.thumb || undefined} />
                <VideoBadge ms={v.ms} small />
              </button>
            ))}
          </div>
        </section>
      ))}
      {folders.length === 0 && <p className="py-8 text-center text-sm text-ink-400">אין סרטונים כאלה עדיין</p>}
    </>
  );
}

function useLongPress(onLong: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const start = () => { fired.current = false; timer.current = setTimeout(() => { fired.current = true; try { navigator.vibrate?.(12); } catch { /* no-op */ } onLong(); }, LONG_PRESS_MS); };
  const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  return { start, cancel, fired };
}

function FolderCard({ f, onOpen, onMenu }: { f: Folder; onOpen: () => void; onMenu: () => void }) {
  const t = useTranslations('photosPage');
  const press = useLongPress(onMenu);
  const [down, setDown] = useState(false);
  // "⋯" on the white strip (Ofer 10-20): the long press's menu, where it can be seen.
  // A sibling over the card, not inside it — a button cannot hold a button.
  return (
    <div className="relative h-full">
    <button
      onClick={() => { if (!press.fired.current) onOpen(); }}
      onPointerDown={() => { prefetchFolder(f.id); setDown(true); press.start(); }}
      onPointerUp={() => { setDown(false); press.cancel(); }}
      onPointerLeave={() => { setDown(false); press.cancel(); }}
      onPointerCancel={() => { setDown(false); press.cancel(); }}
      onContextMenu={(e) => { e.preventDefault(); onMenu(); }}
      className={cn('relative flex h-full w-full flex-col justify-start overflow-hidden rounded-[20px] bg-card text-start shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-transform duration-150 [-webkit-touch-callout:none] select-none', down && 'scale-[0.97]')}
    >
      <div className="relative h-[118px] w-full">
        <Cover src={f.covers[0]} blur={f.coverBlur} />
        <span className="absolute left-2 top-2 flex gap-1">
          {f.count > 0 && <span className="rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-extrabold text-white">📷 <bdi dir="ltr">{f.count}</bdi></span>}
          {!!f.videos && <span className="rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-extrabold text-white">🎬 <bdi dir="ltr">{f.videos}</bdi></span>}
        </span>
        {f.pinned && <span className="absolute right-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-extrabold text-ink-900">📌</span>}
      </div>
      <div className="px-2.5 pb-2.5 pe-9 pt-2">
        <b className="line-clamp-2 block text-[13.5px] font-extrabold leading-tight text-ink-900" dir="auto">{folderTitle(f)}</b>
        <span className="text-[11.5px] text-ink-400">{subline(f, mediaCount(f))}</span>
      </div>
    </button>
    <button type="button" aria-label="אפשרויות לתיקייה" onClick={onMenu}
      className="absolute bottom-1 end-0.5 grid h-11 w-11 place-items-center rounded-full text-ink-400 active:bg-page">
      <MoreHorizontal className="h-5 w-5" />
    </button>
    </div>
  );
}

function FolderView({ id }: { id: string }) {
  const t = useTranslations('photosPage');
  const router = useRouter();
  const params = useSearchParams();
  const { data, error, mutate } = useApi<FolderPhotos>(`/api/photos/browse/folder?id=${encodeURIComponent(id)}`);
  const [open, setOpen] = useState<number | null>(null);
  const [videoOpen, setVideoOpen] = useState<number | null>(null);
  // הכל · תמונות · סרטונים; "?media=videos" lands on the videos (the home's video rows).
  const [media, setMedia] = useState<Media>(() => (params.get('media') === 'videos' ? 'videos' : params.get('media') === 'photos' ? 'photos' : 'all'));
  // The tapped tile, so the viewer can grow the photo out of it.
  const [from, setFrom] = useState<DOMRect | null>(null);
  // Choosing several (mockup photos-redesign + Ofer 10-20): tap to pick, then save or share.
  // "?select=1" lands here already choosing (the long press's "להוריד"); "?cover=1" picks the cover.
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Picking the cover is the admin's (folder-meta route); a ?cover=1 link opens the plain folder for anyone else.
  const { effectiveRole: viewRole } = useNavIdentity();
  const coverMode = params.get('cover') === '1' && viewRole === 'admin';
  // The long press's "להוריד": here already choosing, every photo picked.
  const all = data?.photos.map((p) => p.id).join(',') ?? '';
  useEffect(() => { if (params.get('select') === '1' && all) { setSelecting(true); setPicked(all.split(',')); } }, [params, all]);
  // A folder outside the club's photos folder (an old link from the feed) can't be
  // read here — offer it where it lives instead of a dead end.
  if (error) return (
    <div className="px-4 py-10 text-center">
      <p className="text-sm text-ink-400">{t('folderMissing')}</p>
      <a href={driveLink(id)} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex h-11 items-center rounded-pill bg-brand-600 px-5 text-sm font-extrabold text-white">{t('openInDrive')}</a>
    </div>
  );
  if (!data) return <PhotosLoading what="folder" folderId={id} onRetry={() => { void mutate(); }} />;
  const title = folderTitle(data.folder);
  // "הכל" with both: one line in the order it was shot (Ofer, 10-23: "the session in its
  // order"), photos and videos mixed; each opens in its own viewer at its own index.
  const mixed = media === 'all' && !!data.videos?.length && data.photos.length > 0 && !selecting && !coverMode;
  const timeline = mixed
    ? [...data.photos.map((p, k) => ({ kind: 'photo' as const, k, t: p.t || '' })), ...data.videos!.map((v, k) => ({ kind: 'video' as const, k, t: v.t || '' }))]
      .sort((a, b) => a.t.localeCompare(b.t))
    : null;
  const toggle = (pid: string) => setPicked((x) => (x.includes(pid) ? x.filter((y) => y !== pid) : [...x, pid]));
  const save = async (ids: string[]) => {
    setBusy(true); setNote(null);
    const urls = data.photos.filter((p) => ids.includes(p.id)).map((p) => p.full || p.thumb).filter((u): u is string => !!u);
    const r = await savePhotos(urls, title.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40) || 'madregot');
    setBusy(false);
    setNote(r === 'failed' ? 'לא הצליח. אפשר לנסות שוב.' : r === 'downloaded' ? `ירדו ${urls.length} תמונות` : null);
    if (r !== 'failed') { setSelecting(false); setPicked([]); }
  };
  const share = async () => {
    try { if (navigator.share) await navigator.share({ title, text: `📸 ${title}`, url: driveLink(id) }); else window.open(`https://wa.me/?text=${encodeURIComponent(`📸 ${title} ${driveLink(id)}`)}`, '_blank'); } catch { /* closed */ }
  };
  const setCover = async (pid: string) => {
    setBusy(true);
    const res = await fetch('/api/photos/folder-meta', { method: 'PATCH', headers: await bearerHeaders(), body: JSON.stringify({ id, cover: pid }) }).catch(() => null);
    setBusy(false);
    if (res?.ok) router.push('/dashboard/photos'); else setNote('לא הצליח לשמור את השער');
  };
  return (
    <div className={cn('pb-6', selecting && 'pb-28')}>
      <div className="flex items-center justify-between px-4 pt-2">
        <button onClick={() => router.push('/dashboard/photos')} aria-label={t('back')} className="grid h-11 w-11 place-items-center rounded-full bg-card"><ArrowRight className="h-5 w-5" /></button>
        {!coverMode && (
          <button type="button" onClick={() => { setSelecting((v) => !v); setPicked([]); }} className="min-h-[40px] rounded-full bg-card px-4 text-[14px] font-bold text-brand-600">
            {selecting ? 'ביטול' : 'לבחור'}
          </button>
        )}
      </div>
      <div className="px-[18px] pt-1">
        <h1 className="truncate text-[28px] font-extrabold tracking-tight text-ink-900" dir="auto">{title}</h1>
        <p className="mt-0.5 text-[13.5px] text-ink-500">{subline(data.folder, mediaCount(data.folder))}</p>
      </div>
      {!!data.videos?.length && data.photos.length > 0 && !selecting && !coverMode && (
        <MediaSeg value={media} onChange={setMedia} photos={data.photos.length} videos={data.videos.length} />
      )}
      {coverMode ? (
        <p className="mx-4 mt-3 rounded-2xl bg-brand-600/10 px-3.5 py-2.5 text-13 font-bold text-brand-600">נגיעה בתמונה קובעת אותה כשער של התיקייה</p>
      ) : !selecting && (
        <div className="mt-3 flex gap-2 px-4">
          <a href={driveLink(id)} target="_blank" rel="noopener noreferrer" className="flex min-h-[42px] flex-1 items-center justify-center rounded-xl bg-card text-[13px] font-extrabold text-brand-600">📂 בדרייב</a>
          <button type="button" onClick={() => { void share(); }} className="flex min-h-[42px] flex-1 items-center justify-center rounded-xl bg-card text-[13px] font-extrabold text-brand-600">📤 לשתף</button>
          <button type="button" onClick={() => { setSelecting(true); setPicked(data.photos.map((p) => p.id)); }} className="flex min-h-[42px] flex-1 items-center justify-center rounded-xl bg-card text-[13px] font-extrabold text-brand-600">⬇️ להוריד</button>
        </div>
      )}
      {timeline && (
        <div className="mt-3 grid grid-cols-3 gap-[3px]">
          {timeline.map((it) => it.kind === 'photo' ? (
            <button key={data.photos[it.k].id} type="button" onClick={(e) => { setFrom(e.currentTarget.getBoundingClientRect()); setOpen(it.k); }}
              className="relative aspect-square overflow-hidden bg-page" aria-label={t('photoN', { n: it.k + 1 })}>
              <Cover src={data.photos[it.k].thumb || undefined} blur={data.photos[it.k].blur} />
            </button>
          ) : (
            <button key={data.videos![it.k].id} type="button" onClick={() => setVideoOpen(it.k)} className="relative aspect-square overflow-hidden bg-page" aria-label={`סרטון ${it.k + 1}`}>
              <Cover src={data.videos![it.k].thumb || undefined} blur={data.videos![it.k].blur} />
              <VideoBadge ms={data.videos![it.k].ms} />
            </button>
          ))}
        </div>
      )}
      {!timeline && (media !== 'videos' || selecting || coverMode) && <div className="mt-3 grid grid-cols-3 gap-[3px]">
        {data.photos.map((p, k) => {
          const on = picked.includes(p.id);
          return (
            <button
              key={p.id}
              disabled={busy}
              onClick={(e) => {
                if (coverMode) { void setCover(p.id); return; }
                if (selecting) { toggle(p.id); return; }
                setFrom(e.currentTarget.getBoundingClientRect()); setOpen(k);
              }}
              className={cn('relative aspect-square overflow-hidden bg-page', !selecting && !coverMode && k % 7 === 0 && 'col-span-2 row-span-2')}
              aria-label={t('photoN', { n: k + 1 })}
              aria-pressed={selecting ? on : undefined}
            >
              <Cover src={p.thumb || undefined} blur={p.blur} className={cn(selecting && on && 'scale-[0.92] rounded-lg transition-transform')} />
              {selecting && (
                <span className={cn('absolute left-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full border-2 border-white text-[13px] font-black', on ? 'bg-brand-600 text-white' : 'bg-black/25')}>{on ? '✓' : ''}</span>
              )}
            </button>
          );
        })}
      </div>}
      {/* The videos: tall tiles (they are shot upright), the length and a play mark; nothing loads
          but the poster until one is opened (mockup photos-videos, 2). */}
      {!timeline && media !== 'photos' && !selecting && !coverMode && !!data.videos?.length && (
        <>
          {media === 'all' && data.photos.length > 0 && <div className="flex items-baseline justify-between px-[18px] pb-2 pt-5"><b className="text-[17px] font-extrabold">סרטונים</b><span className="text-[13px] text-ink-400">{data.videos.length}</span></div>}
          <div className={cn('grid grid-cols-3 gap-[3px]', (media === 'videos' || !data.photos.length) && 'mt-3')}>
            {data.videos.map((v, k) => (
              <button key={v.id} type="button" onClick={() => setVideoOpen(k)} className="relative aspect-[9/14] overflow-hidden bg-page" aria-label={`סרטון ${k + 1}`}>
                <Cover src={v.thumb || undefined} blur={v.blur} />
                <VideoBadge ms={v.ms} />
              </button>
            ))}
          </div>
        </>
      )}
      {selecting && (
        <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 border-t border-page bg-page/95 px-4 pb-3 pt-3 backdrop-blur">
          <div className="mx-auto flex max-w-md items-center gap-2">
            <button type="button" onClick={() => setPicked(picked.length === data.photos.length ? [] : data.photos.map((p) => p.id))} className="min-h-[46px] rounded-[14px] bg-card px-3 text-[13px] font-bold text-ink-700">
              {picked.length === data.photos.length ? 'לנקות' : 'הכל'}
            </button>
            <button type="button" disabled={!picked.length || busy} onClick={() => { void save(picked); }}
              className="min-h-[46px] flex-1 rounded-[14px] bg-brand-600 text-[15px] font-extrabold text-white disabled:opacity-40">
              {busy ? 'מכין…' : `⬇️ לשמור ${picked.length || ''} תמונות`}
            </button>
          </div>
          <p className="mt-1.5 text-center text-12 text-ink-400">באייפון: ״שמירת תמונות״ בחלון השיתוף שומר אותן בתמונות</p>
        </div>
      )}
      {note && <p role="status" className="mt-3 text-center text-13 font-bold text-ink-700">{note}</p>}
      {open != null && (
        <PhotoViewer photos={data.photos} index={open} from={from} title={title} onClose={() => setOpen(null)} />
      )}
      {videoOpen != null && data.videos && (
        <VideoViewer videos={data.videos} index={videoOpen} title={title} onClose={() => setVideoOpen(null)}
          onShare={() => { void share(); }}
          onCover={viewRole === 'admin' ? (vid) => { setVideoOpen(null); void setCover(vid); } : undefined} />
      )}
    </div>
  );
}

/**
 * The last answer this phone had, shown at once on the next visit while the fresh one
 * loads (Ofer, 10-19: "opening photos still takes ages"). Not older than the image links
 * in it are good for (lib/photos/drive-browse IMAGE_URL_TTL is 6 h; 5 h leaves a margin).
 */
const KEEP_MS = 5 * 3600_000;
function useKept<T>(key: string | null, fresh: T | undefined): T | undefined {
  const [kept, setKept] = useState<T | undefined>(undefined);
  useEffect(() => {
    if (!key) return;
    try {
      const raw = localStorage.getItem(`mc:kept:${key}`);
      const v = raw ? (JSON.parse(raw) as { at: number; data: T }) : null;
      if (v && Date.now() - v.at < KEEP_MS) setKept(v.data);
    } catch { /* private mode, or a full quota */ }
  }, [key]);
  useEffect(() => {
    if (!key || fresh === undefined) return;
    try { localStorage.setItem(`mc:kept:${key}`, JSON.stringify({ at: Date.now(), data: fresh })); } catch { /* quota */ }
  }, [key, fresh]);
  return fresh ?? kept;
}

function PhotosHome() {
  const t = useTranslations('photosPage');
  const router = useRouter();
  const { data: freshBrowse, error, mutate: reloadBrowse } = useApi<Browse>('/api/photos/browse');
  const data = useKept('/api/photos/browse', freshBrowse);
  const [q, setQ] = useState('');
  // The folder's settings are the admin's (folder-meta route): the view the account is in.
  const { effectiveRole } = useNavIdentity();
  const staff = effectiveRole === 'admin';
  const [menuFor, setMenuFor] = useState<Folder | null>(null);
  // The filter by kind or tag (lib/photos/folder-kind): 'all', a kind, or '#tag'.
  const [filter, setFilter] = useState<string>('all');
  // הכל · תמונות · סרטונים (mockup photos-videos, 1 and 4).
  const [media, setMedia] = useState<Media>('all');
  const allFolders = useMemo(() => (data?.folders ?? []).map((f) => ({ ...f, kind: f.kind ?? kindFromName(f.name), tags: f.tags ?? [] })), [data]);
  const filters = useMemo(() => {
    const kinds = FOLDER_KINDS.filter((k) => allFolders.some((f) => f.kind === k));
    const tags = [...new Set(allFolders.flatMap((f) => f.tags))];
    return [['all', 'הכל'] as const, ...kinds.map((k) => [k, KIND_LABEL[k]] as const), ...tags.map((tg) => [`#${tg}`, `#${tg}`] as const)];
  }, [allFolders]);
  const folders = useMemo(() => allFolders
    .filter((f) => media === 'all' || (media === 'videos' ? !!f.videos : f.count > 0))
    .filter((f) => filter === 'all' || (filter.startsWith('#') ? f.tags.includes(filter.slice(1)) : f.kind === filter)), [allFolders, filter, media]);
  const totals = useMemo(() => ({ photos: allFolders.reduce((a, f) => a + f.count, 0), videos: allFolders.reduce((a, f) => a + (f.videos ?? 0), 0) }), [allFolders]);
  // The big photo is the newest folder whatever the filter; the filter acts on the list under it.
  const latest = allFolders[0];
  // The loader's caption next time (components/photos/PhotosLoading): the newest folder,
  // and every folder's name, so opening one says which.
  useEffect(() => {
    if (!freshBrowse?.folders?.length) return;
    try {
      const byId: Record<string, { title: string; count: number }> = {};
      for (const f of freshBrowse.folders) byId[f.id] = { title: folderTitle(f), count: f.count };
      const l = freshBrowse.folders[0];
      localStorage.setItem(NAMES_KEY, JSON.stringify({ at: Date.now(), latest: { id: l.id, ...byId[l.id] }, byId }));
    } catch { /* quota */ }
  }, [freshBrowse]);
  const latestKey = latest ? `/api/photos/browse/folder?id=${encodeURIComponent(latest.id)}` : null;
  const { data: freshLatest } = useApi<FolderPhotos>(latestKey);
  const latestPhotos = useKept(latestKey, freshLatest);
  const [open, setOpen] = useState<number | null>(null);
  // The tapped tile, so the viewer can grow the photo out of it.
  const [from, setFrom] = useState<DOMRect | null>(null);
  const thisYear = String(new Date().getFullYear());
  const openFolder = (id: string) => router.push(`/dashboard/photos?folder=${encodeURIComponent(id)}`);

  const query = q.trim();
  const results = useMemo(() => {
    if (!query) return null;
    const n = query.toLowerCase();
    return folders.filter((f) => {
      const day = sessionDayLabel(f.date);
      const month = MONTHS[Number(f.date.slice(5, 7)) - 1];
      return textMatches(n, f.name, folderTitle(f)) || day.includes(query) || month.includes(query) || f.date.includes(query);
    });
  }, [folders, query]);
  const byMonth = useMemo(() => {
    const out: Array<[string, Folder[]]> = [];
    for (const f of folders.filter((x) => x.id !== latest?.id)) {
      const k = monthKey(f.date);
      const last = out[out.length - 1];
      if (last && last[0] === k) last[1].push(f); else out.push([k, [f]]);
    }
    return out;
  }, [folders, latest]);

  if (!data && !error) return <PhotosLoading what="home" onRetry={() => { void reloadBrowse(); }} />;
  return (
    <div className="pb-6">
      <h1 className="px-[18px] pt-2 text-[30px] font-extrabold tracking-tight text-ink-900">{t('title')}</h1>
      <label className={cn('mx-4 mt-2.5 flex h-11 items-center gap-2 rounded-[14px] border bg-card px-3.5', query ? 'border-brand-600' : 'border-page')}>
        <Search className={cn('h-[18px] w-[18px] shrink-0', query ? 'text-brand-600' : 'text-ink-400')} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchPlaceholder')} className="min-w-0 flex-1 bg-transparent text-[15px] text-ink-900 outline-none placeholder:text-ink-400" />
        {query && <button onClick={() => setQ('')} aria-label={t('clear')} className="grid h-6 w-6 place-items-center rounded-full bg-ink-300 text-white"><X className="h-3.5 w-3.5" strokeWidth={3} /></button>}
      </label>
      {totals.videos > 0 && <MediaSeg value={media} onChange={setMedia} photos={totals.photos} videos={totals.videos} />}

      {error && <p className="px-4 py-10 text-center text-sm text-ink-400">{t('loadFailed')}</p>}
      {data && !data.configured && <p className="px-4 py-10 text-center text-sm text-ink-400">{t('notConfigured')}</p>}
      {data?.configured && folders.length === 0 && (
        <div className="mx-4 mt-6 rounded-[24px] bg-card px-6 py-10 text-center">
          <ImageOff className="mx-auto h-8 w-8 text-ink-300" />
          <p className="mt-3 font-bold text-ink-700">{t('emptyTitle')}</p>
          <p className="mt-1 text-sm text-ink-500">{t('emptyBody')}</p>
        </div>
      )}

      {results ? (
        <>
          <div className="flex items-baseline justify-between px-[18px] pb-2 pt-5"><b className="text-[17px] font-extrabold">{t('folders')}</b><span className="text-[13px] text-ink-400">{results.length}</span></div>
          <div className="grid grid-cols-2 gap-2.5 px-4">
            {results.map((f) => <FolderCard key={f.id} f={f} onOpen={() => openFolder(f.id)} onMenu={() => setMenuFor(f)} />)}
            {results.length === 0 && <p className="py-6 text-center text-sm text-ink-400">{t('noResults')}</p>}
          </div>
        </>
      ) : media === 'videos' ? (
        <VideoRows folders={folders} onOpen={(id) => router.push(`/dashboard/photos?folder=${encodeURIComponent(id)}&media=videos`)}
          filters={filters} filter={filter} setFilter={setFilter} />
      ) : latest ? (
        <>
          <button onClick={() => openFolder(latest.id)} className="relative mx-4 mt-3.5 block h-[250px] w-[calc(100%-2rem)] overflow-hidden rounded-[24px] text-start">
            <Cover src={latest.hero || latest.covers[0]} />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent from-35% to-black/70" />
            <div className="absolute inset-x-4 bottom-3.5 text-white">
              <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-[11.5px] font-extrabold backdrop-blur">{latest.pinned ? t('pinned') : t('latest')}</span>
              <h2 className="mt-1.5 truncate text-[22px] font-extrabold" dir="auto">{folderTitle(latest)}</h2>
              <p className="text-[13px] opacity-90">{subline(latest, mediaCount(latest))}</p>
            </div>
          </button>
          <div className="flex gap-1.5 overflow-x-auto px-4 pt-2 [scrollbar-width:none]">
            {(latestPhotos?.photos ?? []).slice(0, 12).map((p, k) => (
              <button key={p.id} onClick={(e) => { setFrom(e.currentTarget.getBoundingClientRect()); setOpen(k); }} className="h-[78px] w-[78px] shrink-0 overflow-hidden rounded-[14px] bg-page" aria-label={t('photoN', { n: k + 1 })}>
                <Cover src={p.thumb || undefined} />
              </button>
            ))}
          </div>
          {filters.length > 2 && (
            <div className="flex gap-1.5 overflow-x-auto px-4 pt-4 [scrollbar-width:none]" role="tablist">
              {filters.map(([v, label]) => (
                <button key={v} type="button" role="tab" aria-selected={filter === v} onClick={() => setFilter(v)}
                  style={v.startsWith('#') ? (filter === v ? { background: tagColor(v.slice(1)), color: '#fff' } : { color: tagColor(v.slice(1)) }) : undefined}
                  className={cn('min-h-[36px] shrink-0 rounded-full px-3.5 text-[13px] font-bold', filter === v ? 'bg-ink-900 text-white' : 'bg-card text-ink-500')}>{label}</button>
              ))}
            </div>
          )}
          {byMonth.map(([k, list]) => (
            <section key={k}>
              <div className="flex items-baseline justify-between px-[18px] pb-2 pt-5"><b className="text-[17px] font-extrabold">{monthLabel(k, thisYear)}</b><span className="text-[12.5px] text-ink-400">{list.length} תיקיות</span></div>
              <div className="grid grid-cols-2 gap-2.5 px-4">
                {list.map((f) => <FolderCard key={f.id} f={f} onOpen={() => openFolder(f.id)} onMenu={() => setMenuFor(f)} />)}
              </div>
            </section>
          ))}
          {filter !== 'all' && byMonth.length === 0 && <p className="py-8 text-center text-sm text-ink-400">אין תיקיות כאלה עדיין</p>}
          {open != null && latestPhotos && (
            <PhotoViewer photos={latestPhotos.photos} index={open} from={from} title={folderTitle(latest)} onClose={() => setOpen(null)} />
          )}
        </>
      ) : !data && !error ? (
        <div className="mx-4 mt-3.5 h-[250px] animate-pulse rounded-[24px] bg-card" />
      ) : null}
      {menuFor && (
        <FolderMenu
          folder={{ id: menuFor.id, title: folderTitle(menuFor), count: menuFor.count, cover: menuFor.covers[0], pinned: menuFor.pinned, kind: menuFor.kind ?? kindFromName(menuFor.name), tags: menuFor.tags ?? [] }}
          staff={staff}
          onClose={() => setMenuFor(null)}
          onChanged={() => { void reloadBrowse(); }}
          onDownloadAll={() => router.push(`/dashboard/photos?folder=${encodeURIComponent(menuFor.id)}&select=1`)}
          onPickCover={() => router.push(`/dashboard/photos?folder=${encodeURIComponent(menuFor.id)}&cover=1`)}
        />
      )}
    </div>
  );
}

function Photos() {
  const folder = useSearchParams().get('folder');
  return folder ? <FolderView id={folder} /> : <PhotosHome />;
}

export default function PhotosPage() {
  return <Suspense fallback={null}><Photos /></Suspense>;
}

