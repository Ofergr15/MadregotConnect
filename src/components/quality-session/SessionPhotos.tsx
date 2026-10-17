'use client';

import { useEffect, useRef, useState } from 'react';
import { apiHeaders, useApi } from '@/lib/api';
import { uploadMedia, type FeedMedia } from '@/lib/feed-client';
import { MAX_SESSION_PHOTOS, cleanPhotosLink } from '@/lib/quality-session/photos';
import { cn } from '@/lib/utils';

// "📸 תמונות מהאימון" at the bottom of the quality-session screen (#106, mockup
// ~/.cache/madregot/feed-photos-106/mockup-v2.html): paste the link to the
// photographer's album, optionally pick up to six photos for the feed, publish
// one card. A second publish updates the same card.
//
// The `!` on the buttons' looks is deliberate: the screen's stylesheet resets
// every button under .qsx (quality-session.css, `.qsx button{background:none;
// border:0}`), which outranks a single utility class.

interface Card { id: string; link: string; media: FeedMedia[] }

export function SessionPhotos({ date }: { date: string }) {
  const { data, mutate } = useApi<{ card: Card | null }>(`/api/quality-session/photos?date=${date}`);
  const card = data?.card ?? null;
  const [link, setLink] = useState('');
  const [media, setMedia] = useState<FeedMedia[]>([]);
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState<'upload' | 'publish' | 'remove' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // What is already published is the starting point for an edit.
  useEffect(() => {
    if (card) { setLink(card.link); setMedia(card.media); }
  }, [card?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const ok = !!cleanPhotosLink(link);

  const pickFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy('upload');
    setMsg(null);
    try {
      const room = MAX_SESSION_PHOTOS - media.length;
      const added: FeedMedia[] = [];
      for (const f of [...files].slice(0, room)) added.push(await uploadMedia(f));
      setMedia((m) => [...m, ...added]);
    } catch {
      setMsg('לא הצלחתי להעלות תמונה. נסו שוב.');
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const publish = async () => {
    if (!ok) return;
    setBusy('publish');
    setMsg(null);
    try {
      const res = await fetch('/api/quality-session/photos', {
        method: 'POST',
        headers: { ...(await apiHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, link, media: media.map(({ path, w, h }) => ({ path, w, h })), notify }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'failed');
      setMsg(out.updated ? '✓ עודכן בפיד' : out.told ? `✓ בפיד · נשלחה הודעה ל־${out.told}` : '✓ בפיד');
      await mutate();
    } catch (e) {
      setMsg((e as Error).message === 'bad-link' ? 'הקישור לא תקין — צריך להתחיל ב־https://' : 'הפרסום לא הצליח. נסו שוב.');
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('remove');
    try {
      await fetch(`/api/quality-session/photos?date=${date}`, { method: 'DELETE', headers: await apiHeaders() });
      setLink(''); setMedia([]); setMsg('הכרטיס הוסר מהפיד');
      await mutate();
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mb-2 rounded-[20px] bg-white p-3.5" dir="rtl">
      <p className="text-[15px] font-black text-ink-900">📸 תמונות מהאימון</p>
      {card && <p className="mt-0.5 text-xs font-semibold text-accent-900">כבר בפיד — אפשר לעדכן</p>}

      <label className="mt-3 block text-xs font-semibold text-ink-400" htmlFor="qs-photos-link">קישור לכל התמונות</label>
      <input
        id="qs-photos-link"
        type="url"
        inputMode="url"
        dir="ltr"
        value={link}
        onChange={(e) => setLink(e.target.value)}
        placeholder="https://photos.app.goo.gl/…"
        className="mt-1 block min-h-[44px] w-full rounded-xl border-[1.5px] border-page bg-white px-3 text-[15px] text-ink-900 focus:border-brand-600 focus:outline-none"
      />
      <p className="mt-1 text-[11px] text-ink-400">דרייב, Google Photos, אלבום וואטסאפ — כל קישור.</p>

      <p className="mt-3 text-xs font-semibold text-ink-400">כמה תמונות לפיד (לא חובה, עד {MAX_SESSION_PHOTOS})</p>
      <div className="mt-1.5 grid grid-cols-4 gap-1.5">
        {media.map((m) => (
          <div key={m.path} className="relative aspect-square overflow-hidden rounded-lg bg-page">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={m.url} alt="" className="h-full w-full object-cover" />
            <button
              type="button"
              aria-label="להסיר תמונה"
              onClick={() => setMedia((all) => all.filter((x) => x.path !== m.path))}
              className="absolute end-0.5 top-0.5 flex h-6 w-6 items-center justify-center !rounded-full !bg-black/55 !text-center text-xs font-bold !text-white"
            >
              ✕
            </button>
          </div>
        ))}
        {media.length < MAX_SESSION_PHOTOS && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy === 'upload'}
            className="flex aspect-square items-center justify-center !rounded-lg !border-2 !border-dashed !border-ink-300 !text-center text-2xl !text-ink-400"
          >
            {busy === 'upload' ? '…' : '+'}
          </button>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*,image/heic,image/heif" multiple hidden onChange={(e) => pickFiles(e.target.files)} />

      {!card && (
        <label className="mt-3 flex min-h-[44px] items-center justify-between gap-3 text-sm text-ink-700">
          <span>להודיע למי שסימן &quot;מגיע&quot; לאימון</span>
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-5 w-5 accent-brand-600" />
        </label>
      )}

      <button
        type="button"
        disabled={!ok || busy !== null}
        onClick={publish}
        className={cn('mt-3 block min-h-[48px] w-full !rounded-pill !bg-brand-600 !text-center text-[15px] font-extrabold !text-white', (!ok || busy) && 'opacity-50')}
      >
        {busy === 'publish' ? 'מפרסם…' : card ? 'לעדכן בפיד' : 'לפרסם בפיד'}
      </button>
      {card && (
        <button type="button" disabled={busy !== null} onClick={remove} className="mt-2 block min-h-[40px] w-full !text-center text-sm font-bold !text-ink-400">
          להסיר מהפיד
        </button>
      )}
      {msg && <p className="mt-2 text-center text-sm font-semibold text-ink-700">{msg}</p>}
    </section>
  );
}
