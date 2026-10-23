'use client';

import { useState } from 'react';
import { Sheet } from '@/components/ui';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { cn } from '@/lib/utils';
import { FOLDER_KINDS, KIND_LABEL, SUGGESTED_TAGS, type FolderKind, tagColor } from '@/lib/photos/folder-kind';

// The long press on a photo folder (mockup photos-redesign, 2). For everyone: Drive, the
// folder's link, share, download. For staff: pin, rename, its kind and tags, the cover.
// Nothing here deletes a photo: the app never does (Ofer, 10-20).

export interface MenuFolder { id: string; title: string; count: number; cover?: string; pinned?: boolean; kind: FolderKind; tags: string[] }

export const driveLink = (id: string) => `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`;

export function FolderMenu({ folder, staff, onClose, onChanged, onDownloadAll, onPickCover }: {
  folder: MenuFolder; staff: boolean; onClose: () => void; onChanged: () => void; onDownloadAll: () => void; onPickCover: () => void;
}) {
  const [mode, setMode] = useState<'menu' | 'rename' | 'kind'>('menu');
  const [title, setTitle] = useState(folder.title);
  const [kind, setKind] = useState<FolderKind>(folder.kind);
  const [tags, setTags] = useState<string[]>(folder.tags);
  const [newTag, setNewTag] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch('/api/photos/folder-meta', { method: 'PATCH', headers: await bearerHeaders(), body: JSON.stringify({ id: folder.id, ...body }) });
      if (!res.ok) throw new Error();
      onChanged(); onClose();
    } catch { setNote('לא הצליח. אפשר לנסות שוב.'); } finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(driveLink(folder.id)); setNote('הקישור הועתק'); } catch { setNote(driveLink(folder.id)); }
  };
  const share = async () => {
    const data = { title: folder.title, text: `📸 ${folder.title}`, url: driveLink(folder.id) };
    try {
      if (navigator.share) await navigator.share(data);
      else window.open(`https://wa.me/?text=${encodeURIComponent(`${data.text} ${data.url}`)}`, '_blank');
    } catch { /* the person closed the share sheet */ }
  };

  // A render helper, not a component (a component declared here remounts every render).
  const row = ({ icon, label, onClick, blue }: { icon: string; label: string; onClick: () => void; blue?: boolean }) => (
    <button key={icon} type="button" onClick={onClick} disabled={busy}
      className={cn('flex min-h-[50px] w-full items-center gap-3 border-b border-page px-4 text-start text-[15px] last:border-0', blue ? 'text-brand-600' : 'text-ink-900')}>
      <span aria-hidden className="w-6 text-center">{icon}</span>{label}
    </button>
  );

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <div dir="rtl" className="pb-3">
        <div className="flex items-center gap-3 border-b border-page px-4 pb-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {folder.cover ? <img src={folder.cover} alt="" className="h-12 w-12 rounded-xl object-cover" /> : <span className="h-12 w-12 rounded-xl bg-page" />}
          <span className="min-w-0"><b className="block truncate text-[15px] text-ink-900" dir="auto">{folder.title}</b><small className="text-12 text-ink-400">{folder.count} תמונות</small></span>
        </div>

        {mode === 'menu' && (
          <>
            {row({ icon: '📂', label: 'לפתוח בגוגל דרייב', onClick: () => { window.open(driveLink(folder.id), '_blank', 'noopener'); onClose(); } })}
            {row({ icon: '🔗', label: 'להעתיק קישור לתיקייה', onClick: () => { void copy(); } })}
            {row({ icon: '📤', label: 'לשתף', onClick: () => { void share(); } })}
            {row({ icon: '⬇️', label: 'להוריד תמונות', onClick: () => { onDownloadAll(); onClose(); } })}
            {staff && (
              <>
                <p className="px-4 pb-1 pt-3 text-[11.5px] font-extrabold text-ink-400">למנהל</p>
                {row({ blue: true, icon: '📌', label: folder.pinned ? 'לבטל הצמדה' : 'להצמיד למעלה', onClick: () => { void patch({ pinned: !folder.pinned }); } })}
                {row({ blue: true, icon: '✏️', label: 'לשנות שם', onClick: () => setMode('rename') })}
                {row({ blue: true, icon: '🏷️', label: `סוג ותגיות · ${KIND_LABEL[folder.kind]}${folder.tags.length ? ` · ${folder.tags.map((t) => `#${t}`).join(' ')}` : ''}`, onClick: () => setMode('kind') })}
                {row({ blue: true, icon: '🖼️', label: 'לבחור תמונת שער', onClick: () => { onPickCover(); onClose(); } })}
              </>
            )}
          </>
        )}

        {mode === 'rename' && (
          <div className="space-y-2 px-4 pt-3">
            <input value={title} onChange={(e) => setTitle(e.target.value)} dir="auto" autoFocus
              className="min-h-[48px] w-full rounded-xl border-[1.5px] border-page bg-white px-3 text-[16px] text-ink-900" />
            <p className="text-12 text-ink-400">רק השם באפליקציה. בדרייב השם לא משתנה.</p>
            <button type="button" disabled={busy || !title.trim()} onClick={() => { void patch({ title }); }}
              className="min-h-[48px] w-full rounded-[14px] bg-brand-600 text-[15px] font-extrabold text-white disabled:opacity-40">לשמור</button>
          </div>
        )}

        {mode === 'kind' && (
          <div className="space-y-3 px-4 pt-3">
            <div className="flex flex-wrap gap-1.5">
              {FOLDER_KINDS.map((k) => (
                <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
                  className={cn('min-h-[38px] rounded-full px-3.5 text-[13.5px] font-bold', kind === k ? 'bg-ink-900 text-white' : 'bg-page text-ink-500')}>{KIND_LABEL[k]}</button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[...new Set([...SUGGESTED_TAGS, ...tags])].map((tg) => {
                const on = tags.includes(tg);
                return (
                  <button key={tg} type="button" aria-pressed={on} onClick={() => setTags((x) => (on ? x.filter((y) => y !== tg) : [...x, tg]))}
                    style={on ? { background: tagColor(tg), color: '#fff' } : { color: tagColor(tg) }}
                    className="min-h-[34px] rounded-full bg-page px-3 text-[13px] font-bold">#{tg}</button>
                );
              })}
            </div>
            <div className="flex gap-1.5">
              <input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="תגית אחרת"
                className="min-h-[42px] flex-1 rounded-xl border-[1.5px] border-page bg-white px-3 text-[15px] text-ink-900" />
              <button type="button" disabled={!newTag.trim()} onClick={() => { setTags((x) => [...new Set([...x, newTag.trim()])]); setNewTag(''); }}
                className="min-h-[42px] rounded-xl bg-page px-3 text-[13px] font-bold text-brand-600 disabled:opacity-40">להוסיף</button>
            </div>
            <button type="button" disabled={busy} onClick={() => { void patch({ kind, tags }); }}
              className="min-h-[48px] w-full rounded-[14px] bg-brand-600 text-[15px] font-extrabold text-white disabled:opacity-40">לשמור</button>
          </div>
        )}
        {note && <p role="status" className="px-4 pt-2 text-center text-13 font-bold text-ink-700" dir="auto">{note}</p>}
      </div>
    </Sheet>
  );
}

/**
 * Photos to the phone: the share sheet with the files where the phone can (iPhone: "Save N
 * images" lands them in Photos), a download of each where it can't. Fetched one by one.
 */
export async function savePhotos(urls: string[], name: string): Promise<'shared' | 'downloaded' | 'failed'> {
  try {
    const files: File[] = [];
    for (const [i, u] of urls.slice(0, 40).entries()) {
      const res = await fetch(u);
      if (!res.ok) continue;
      const blob = await res.blob();
      files.push(new File([blob], `${name}-${i + 1}.jpg`, { type: blob.type || 'image/jpeg' }));
    }
    if (!files.length) return 'failed';
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.canShare?.({ files }) && navigator.share) {
      await navigator.share({ files, title: name });
      return 'shared';
    }
    for (const f of files) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(f); a.download = f.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
    return 'downloaded';
  } catch {
    return 'failed';
  }
}
