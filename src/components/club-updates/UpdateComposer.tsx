'use client';

import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Pin, X } from 'lucide-react';
import { Sheet, Switch } from '@/components/ui';
import { MentionTextarea } from '@/components/MentionTextarea';
import { uploadMedia } from '@/lib/feed-client';
import { cn } from '@/lib/utils';
import { MAX_CHARS, visibleLength } from '@/lib/club-updates/model';
import type { ClubUpdate } from '@/lib/club-updates/server';

const DRAFT_KEY = 'mc:club-update-draft';

export interface ComposerValue { body: string; imageUrl: string | null; breaking: boolean; pinned: boolean }

/**
 * Writing and editing an update — one sheet for both (mockup screens 7 and 11). A new one
 * keeps a draft if the sheet is closed half-way; an edit says it sends no push again.
 */
export function UpdateComposer({ open, onOpenChange, me, editing, onSubmit }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  me: string | null;
  editing: ClubUpdate | null;
  onSubmit: (v: ComposerValue) => Promise<void>;
}) {
  const [v, setV] = useState<ComposerValue>({ body: '', imageUrl: null, breaking: false, pinned: false });
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    if (editing) {
      setV({ body: editing.body, imageUrl: editing.imageUrl, breaking: editing.breaking, pinned: editing.pinned });
    } else {
      let d: Partial<ComposerValue> = {};
      try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}') as Partial<ComposerValue>; } catch { /* a broken draft is no draft */ }
      setV({
        body: typeof d.body === 'string' ? d.body : '',
        imageUrl: typeof d.imageUrl === 'string' ? d.imageUrl : null,
        breaking: d.breaking === true,
        pinned: d.pinned === true,
      });
    }
  }, [open, editing]);
  // The draft of a new update outlives a closed sheet.
  useEffect(() => {
    if (!open || editing) return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(v)); } catch { /* private mode */ }
  }, [v, open, editing]);

  const len = visibleLength(v.body);
  const tooLong = len > MAX_CHARS;
  const canSend = v.body.trim().length > 0 && !tooLong && !uploading && !busy;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true); setErr(null);
    try { const m = await uploadMedia(file); setV((x) => ({ ...x, imageUrl: m.url })); }
    catch (e) { setErr((e as Error).message || 'ההעלאה נכשלה'); }
    finally { setUploading(false); }
  };

  const submit = async () => {
    if (!canSend) return;
    setBusy(true); setErr(null);
    try {
      await onSubmit({ ...v, body: v.body.trim() });
      if (!editing) { try { localStorage.removeItem(DRAFT_KEY); } catch { /* */ } }
      onOpenChange(false);
    } catch (e) {
      setErr((e as Error).message || 'לא הצלחנו לפרסם');
    } finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={editing ? 'עריכת עדכון' : 'עדכון חדש'}>
      <div className="cu space-y-3 px-4 pb-4" dir="rtl">
        <div className="relative">
          <MentionTextarea
            value={v.body}
            onChange={(body) => setV((x) => ({ ...x, body }))}
            viewerId={me}
            placeholder="מה קורה עכשיו? @ לתייג רץ"
            autoFocus
            rows={3}
            autoGrow
            autoGrowMax={200}
            className="w-full rounded-2xl border-[1.5px] border-[#E4E5EC] bg-card px-3 py-2.5 text-[16px] leading-[1.55] text-ink-900 focus:border-brand-600 focus:outline-none"
          />
          <span className={cn('pointer-events-none absolute bottom-2 end-3 text-[11px] tabular-nums', tooLong ? 'font-bold text-accent-red' : 'text-ink-400')}>
            <bdi>{len}/{MAX_CHARS}</bdi>
          </span>
        </div>

        {v.imageUrl && (
          <div className="relative inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={v.imageUrl} alt="" className="h-[72px] w-[72px] rounded-xl object-cover" />
            <button type="button" onClick={() => setV((x) => ({ ...x, imageUrl: null }))} aria-label="להסיר את התמונה"
              className="absolute -end-2.5 -top-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-ink-900 text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
            className="flex min-h-[44px] items-center gap-1.5 rounded-pill bg-page px-3.5 text-[13px] font-bold text-ink-700 disabled:opacity-60">
            <ImagePlus className="h-4 w-4" />{uploading ? 'מעלה…' : v.imageUrl ? 'להחליף תמונה' : 'תמונה'}
          </button>
          <button type="button" onClick={() => setV((x) => ({ ...x, pinned: !x.pinned }))} aria-pressed={v.pinned}
            className={cn('flex min-h-[44px] items-center gap-1.5 rounded-pill px-3.5 text-[13px] font-bold', v.pinned ? 'bg-[#E6E8FF] text-brand-600' : 'bg-page text-ink-700')}>
            <Pin className="h-4 w-4" />{v.pinned ? 'נעוץ · תמיד בפיד' : 'לנעוץ'}
          </button>
        </div>

        <label className={cn('flex min-h-[56px] items-center gap-3 rounded-2xl border px-3.5 py-2.5', v.breaking ? 'border-[#FFD0BE] bg-[#FFF3EE]' : 'border-[#E9E9EF] bg-[#F6F6F9]')}>
          <span className="min-w-0 flex-1">
            <b className={cn('block text-[14px]', v.breaking ? 'text-[#A8340A]' : 'text-ink-900')}>מבזק</b>
            <small className={cn('block text-[11.5px]', v.breaking ? 'text-[#B7613F]' : 'text-ink-400')}>
              {editing
                ? (editing.breaking ? 'שמירה לא שולחת התראה שוב' : 'כתום בזרם · לא נשלחת התראה בעריכה')
                : 'כתום בזרם, והתראה לכל המועדון'}
            </small>
          </span>
          <Switch checked={v.breaking} onChange={(breaking) => setV((x) => ({ ...x, breaking }))} activeColor="bg-[#FF5315]" ariaLabel="מבזק" />
        </label>

        {err && <p className="text-[13px] font-bold text-accent-red" role="alert">{err}</p>}
        <button type="button" onClick={() => void submit()} disabled={!canSend}
          className={cn('flex min-h-[52px] w-full items-center justify-center rounded-[18px] text-[16px] font-black text-white disabled:opacity-50', v.breaking && !editing ? 'bg-[#E8470F]' : 'bg-brand-600')}>
          {busy ? 'רגע…' : editing ? 'לשמור' : v.breaking ? 'לפרסם כמבזק' : 'לפרסם'}
        </button>
        {!editing && <p className="text-center text-[11.5px] text-ink-400">מתפרסם מיד. אפשר לבטל ב־6 השניות הראשונות.</p>}
      </div>
    </Sheet>
  );
}
