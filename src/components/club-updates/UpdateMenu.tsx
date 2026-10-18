'use client';

import { Link2, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { Sheet } from '@/components/ui';
import type { ClubUpdate } from '@/lib/club-updates/server';

/** "•••" on an update (mockup screen 10): edit, pin, breaking on/off, copy link, delete. */
export function UpdateMenu({ update, onClose, onEdit, onPin, onBreaking, onCopy, onDelete }: {
  update: ClubUpdate | null;
  onClose: () => void;
  onEdit: () => void;
  onPin: () => void;
  onBreaking: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const u = update;
  const row = 'flex min-h-[56px] w-full items-center gap-3 border-b border-page px-4 text-start text-[15.5px] font-bold text-ink-900 last:border-0 active:bg-page';
  const ic = 'flex h-8 w-8 items-center justify-center rounded-[10px]';
  return (
    <Sheet open={!!u} onOpenChange={(o) => { if (!o) onClose(); }} title="העדכון">
      {u && (
        <div className="space-y-2 px-3 pb-4" dir="rtl">
          <div className="overflow-hidden rounded-[20px] bg-card">
            <button type="button" className={row} onClick={onEdit}><span className={`${ic} bg-[#EEF0FF]`}><Pencil className="h-4 w-4 text-brand-600" /></span>עריכה<small className="ms-auto text-[11.5px] font-semibold text-ink-400">בלי התראה חוזרת</small></button>
            <button type="button" className={row} onClick={onPin}><span className={`${ic} bg-[#EEF0FF]`}>{u.pinned ? <PinOff className="h-4 w-4 text-brand-600" /> : <Pin className="h-4 w-4 text-brand-600" />}</span>{u.pinned ? 'לבטל נעיצה' : 'לנעוץ למעלה'}</button>
            <button type="button" className={row} onClick={onBreaking}><span className={`${ic} bg-[#FFE6DB] text-[15px]`}>🟠</span>{u.breaking ? 'להסיר ממבזק' : 'לסמן כמבזק'}<small className="ms-auto text-[11.5px] font-semibold text-ink-400">{u.breaking ? 'התראה שנשלחה נשארת' : 'בלי התראה'}</small></button>
            <button type="button" className={row} onClick={onCopy}><span className={`${ic} bg-[#EEF0FF]`}><Link2 className="h-4 w-4 text-brand-600" /></span>העתקת קישור</button>
          </div>
          <div className="overflow-hidden rounded-[20px] bg-card">
            <button type="button" className={`${row} text-[#D92D20]`} onClick={onDelete}><span className={`${ic} bg-[#FDECEA]`}><Trash2 className="h-4 w-4 text-[#D92D20]" /></span>מחיקה</button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
