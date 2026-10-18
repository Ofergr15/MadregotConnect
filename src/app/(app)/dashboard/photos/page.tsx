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

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, ImageOff, Search, X } from 'lucide-react';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { sessionDayLabel } from '@/lib/quality-session/photos';
import { PhotoViewer } from '@/components/photos/PhotoViewer';

interface Folder { id: string; name: string; date: string; count: number; covers: string[]; hero?: string | null }
interface Browse { configured: boolean; folders: Folder[] }
interface FolderPhotos { folder: Folder; photos: Array<{ id: string; thumb: string | null; full: string | null }> }

const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const monthKey = (date: string) => date.slice(0, 7);
const monthLabel = (key: string, thisYear: string) => {
  const [y, m] = key.split('-');
  return `${MONTHS[Number(m) - 1]}${y !== thisYear ? ` ${y}` : ''}`;
};

/** "שישי 16.10 · 19 תמונות" — the day only when the folder's own name doesn't already say it. */
function subline(f: Folder, count: string): string {
  const day = sessionDayLabel(f.date);
  const dm = day.split(' ')[1];
  return f.name && dm && f.name.includes(dm) ? count : `${day} · ${count}`;
}

function Cover({ src, className }: { src?: string; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="" loading="lazy" className={cn('h-full w-full object-cover', className)} /> : <div className={cn('h-full w-full bg-page', className)} />;
}

function FolderCard({ f, onOpen }: { f: Folder; onOpen: () => void }) {
  const t = useTranslations('photosPage');
  return (
    <button onClick={onOpen} className="relative flex w-full items-center gap-3 rounded-[20px] bg-card p-2 text-start shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="grid h-[84px] w-[118px] shrink-0 grid-cols-[2fr_1fr] grid-rows-2 gap-[3px] overflow-hidden rounded-[14px]">
        <Cover src={f.covers[0]} className="row-span-2" />
        <Cover src={f.covers[1] || f.covers[0]} />
        <Cover src={f.covers[2] || f.covers[0]} />
      </div>
      <div className="min-w-0">
        <b className="block truncate text-[15.5px] font-extrabold text-ink-900" dir="auto">{f.name || sessionDayLabel(f.date)}</b>
        <span className="text-[12.5px] text-ink-500">{subline(f, t('count', { n: f.count }))}</span>
      </div>
    </button>
  );
}

function FolderView({ id }: { id: string }) {
  const t = useTranslations('photosPage');
  const router = useRouter();
  const { data, error } = useApi<FolderPhotos>(`/api/photos/browse/folder?id=${encodeURIComponent(id)}`);
  const [open, setOpen] = useState<number | null>(null);
  // A folder outside the club's photos folder (an old link from the feed) can't be
  // read here — offer it where it lives instead of a dead end.
  if (error) return (
    <div className="px-4 py-10 text-center">
      <p className="text-sm text-ink-400">{t('folderMissing')}</p>
      <a href={`https://drive.google.com/drive/folders/${encodeURIComponent(id)}`} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex h-11 items-center rounded-pill bg-brand-600 px-5 text-sm font-extrabold text-white">{t('openInDrive')}</a>
    </div>
  );
  return (
    <div className="pb-6">
      <div className="flex items-center px-4 pt-2">
        <button onClick={() => router.push('/dashboard/photos')} aria-label={t('back')} className="grid h-11 w-11 place-items-center rounded-full bg-card"><ArrowRight className="h-5 w-5" /></button>
      </div>
      <div className="px-[18px] pt-1">
        <h1 className="truncate text-[28px] font-extrabold tracking-tight text-ink-900" dir="auto">{data ? (data.folder.name || sessionDayLabel(data.folder.date)) : ' '}</h1>
        {data && <p className="mt-0.5 text-[13.5px] text-ink-500">{subline(data.folder, t('count', { n: data.folder.count }))}</p>}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-[3px]">
        {(data?.photos ?? Array.from({ length: 12 }, (_, k) => ({ id: `s${k}`, thumb: null, full: null }))).map((p, k) => (
          <button
            key={p.id}
            onClick={() => data && setOpen(k)}
            className={cn('aspect-square overflow-hidden bg-page', k % 7 === 0 && 'col-span-2 row-span-2')}
            aria-label={t('photoN', { n: k + 1 })}
          >
            <Cover src={p.thumb || undefined} />
          </button>
        ))}
      </div>
      {open != null && data && (
        <PhotoViewer photos={data.photos} index={open} title={data.folder.name} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

function PhotosHome() {
  const t = useTranslations('photosPage');
  const router = useRouter();
  const { data, error } = useApi<Browse>('/api/photos/browse');
  const [q, setQ] = useState('');
  const folders = useMemo(() => data?.folders ?? [], [data]);
  const latest = folders[0];
  const { data: latestPhotos } = useApi<FolderPhotos>(latest ? `/api/photos/browse/folder?id=${encodeURIComponent(latest.id)}` : null);
  const [open, setOpen] = useState<number | null>(null);
  const thisYear = String(new Date().getFullYear());
  const openFolder = (id: string) => router.push(`/dashboard/photos?folder=${encodeURIComponent(id)}`);

  const query = q.trim();
  const results = useMemo(() => {
    if (!query) return null;
    const n = query.toLowerCase();
    return folders.filter((f) => {
      const day = sessionDayLabel(f.date);
      const month = MONTHS[Number(f.date.slice(5, 7)) - 1];
      return f.name.toLowerCase().includes(n) || day.includes(query) || month.includes(query) || f.date.includes(query);
    });
  }, [folders, query]);
  const byMonth = useMemo(() => {
    const out: Array<[string, Folder[]]> = [];
    for (const f of folders.slice(1)) {
      const k = monthKey(f.date);
      const last = out[out.length - 1];
      if (last && last[0] === k) last[1].push(f); else out.push([k, [f]]);
    }
    return out;
  }, [folders]);

  return (
    <div className="pb-6">
      <h1 className="px-[18px] pt-2 text-[30px] font-extrabold tracking-tight text-ink-900">{t('title')}</h1>
      <label className={cn('mx-4 mt-2.5 flex h-11 items-center gap-2 rounded-[14px] border bg-card px-3.5', query ? 'border-brand-600' : 'border-page')}>
        <Search className={cn('h-[18px] w-[18px] shrink-0', query ? 'text-brand-600' : 'text-ink-400')} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchPlaceholder')} className="min-w-0 flex-1 bg-transparent text-[15px] text-ink-900 outline-none placeholder:text-ink-400" />
        {query && <button onClick={() => setQ('')} aria-label={t('clear')} className="grid h-6 w-6 place-items-center rounded-full bg-ink-300 text-white"><X className="h-3.5 w-3.5" strokeWidth={3} /></button>}
      </label>

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
          <div className="space-y-2.5 px-4">
            {results.map((f) => <FolderCard key={f.id} f={f} onOpen={() => openFolder(f.id)} />)}
            {results.length === 0 && <p className="py-6 text-center text-sm text-ink-400">{t('noResults')}</p>}
          </div>
        </>
      ) : latest ? (
        <>
          <button onClick={() => openFolder(latest.id)} className="relative mx-4 mt-3.5 block h-[250px] w-[calc(100%-2rem)] overflow-hidden rounded-[24px] text-start">
            <Cover src={latest.hero || latest.covers[0]} />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent from-35% to-black/70" />
            <div className="absolute inset-x-4 bottom-3.5 text-white">
              <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-[11.5px] font-extrabold backdrop-blur">{t('latest')}</span>
              <h2 className="mt-1.5 truncate text-[22px] font-extrabold" dir="auto">{latest.name || sessionDayLabel(latest.date)}</h2>
              <p className="text-[13px] opacity-90">{subline(latest, t('count', { n: latest.count }))}</p>
            </div>
          </button>
          <div className="flex gap-1.5 overflow-x-auto px-4 pt-2 [scrollbar-width:none]">
            {(latestPhotos?.photos ?? []).slice(0, 12).map((p, k) => (
              <button key={p.id} onClick={() => setOpen(k)} className="h-[78px] w-[78px] shrink-0 overflow-hidden rounded-[14px] bg-page" aria-label={t('photoN', { n: k + 1 })}>
                <Cover src={p.thumb || undefined} />
              </button>
            ))}
          </div>
          {byMonth.map(([k, list]) => (
            <section key={k}>
              <div className="px-[18px] pb-2 pt-5"><b className="text-[17px] font-extrabold">{monthLabel(k, thisYear)}</b></div>
              <div className="space-y-2.5 px-4">
                {list.map((f) => <FolderCard key={f.id} f={f} onOpen={() => openFolder(f.id)} />)}
              </div>
            </section>
          ))}
          {open != null && latestPhotos && (
            <PhotoViewer photos={latestPhotos.photos} index={open} title={latest.name} onClose={() => setOpen(null)} />
          )}
        </>
      ) : !data && !error ? (
        <div className="mx-4 mt-3.5 h-[250px] animate-pulse rounded-[24px] bg-card" />
      ) : null}
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

