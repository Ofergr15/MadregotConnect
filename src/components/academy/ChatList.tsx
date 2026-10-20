'use client';

import { useMemo, useState } from 'react';
import { Search, SquarePen } from 'lucide-react';
import { Sheet } from '@/components/ui';
import { cn } from '@/lib/utils';
import { chatCounts, chatPreview, chatSections, chatTimeLabel, hasThread, type ChatFilter, type ChatRow } from '@/lib/academy/chat-list';
import { seatInitials } from '@/lib/academy/seat-style';

// ── The academy chat, Messenger-shaped (mockup academy-chat/chat.html, Ofer 10-20) ──
//
// Every conversation in one list: photo, name, the newest message and who wrote it,
// when, and how many are new. The order is lib/academy/chat-list.ts — owed an answer
// pinned on top, then by newest message. RED appears only on the rows that are owed
// an answer (see ThreadInbox for why a second warm colour smeared the list once).

export interface ChatPayload {
  rows: ChatRow[];
  viewerId?: string | null;
  viewerGender?: string | null;
  degraded?: boolean;
}

const PALETTE = ['#db2777', '#059669', '#7c3aed', '#d97706', '#0891b2', '#65a30d', '#dc2626', '#4f46e5'];
const colorOf = (id: string) => {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
};

export function ChatAvatar({ row, size = 54 }: { row: Pick<ChatRow, 'athleteId' | 'name' | 'avatarUrl'>; size?: number }) {
  return row.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={row.avatarUrl} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="grid shrink-0 place-items-center rounded-full font-extrabold text-white"
      style={{ width: size, height: size, background: colorOf(row.athleteId), fontSize: size * 0.36 }}>
      {seatInitials(row.name)}
    </span>
  );
}

const FILTERS: Array<[ChatFilter, string]> = [['all', 'הכל'], ['unread', 'לא נקראו'], ['waiting', 'ממתינים לי'], ['mine', 'שלי']];

export function ChatList({ data, onOpen }: { data: ChatPayload; onOpen?: (athleteId: string) => void }) {
  const [filter, setFilter] = useState<ChatFilter>('all');
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState(false);
  const counts = useMemo(() => chatCounts(data.rows), [data.rows]);
  const { waiting, recent } = useMemo(() => chatSections(data.rows, filter, query), [data.rows, filter, query]);
  const countOf: Partial<Record<ChatFilter, number>> = { unread: counts.unread, waiting: counts.waiting, mine: counts.mine };

  return (
    <div dir="rtl" className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-[28px] font-black text-ink-900">שיחות</h2>
        <button type="button" onClick={() => setPicking(true)} aria-label="שיחה חדשה"
          className="grid h-11 w-11 place-items-center rounded-full bg-card text-brand-600">
          <SquarePen className="h-5 w-5" />
        </button>
      </div>

      <label className="flex min-h-[40px] items-center gap-2 rounded-xl bg-card px-3 text-ink-400">
        <Search className="h-4 w-4 shrink-0" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="חיפוש מתאמן או הודעה" aria-label="חיפוש"
          className="min-h-[40px] flex-1 bg-transparent text-base text-ink-900 placeholder:text-ink-400 focus:outline-none" />
      </label>

      <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]" role="tablist">
        {FILTERS.filter(([f]) => f !== 'mine' || counts.mine > 0).map(([f, label]) => (
          <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
            className={cn('min-h-[36px] shrink-0 rounded-full px-3.5 text-[13px] font-bold', filter === f ? 'bg-[#d9fdd3] text-[#0b6b2e]' : 'bg-card text-ink-500')}>
            {label}{countOf[f] ? <> · <bdi dir="ltr">{countOf[f]}</bdi></> : null}
          </button>
        ))}
      </div>

      {data.degraded && <p className="px-1 text-xs text-ink-400">הצ׳אט לא זמין כרגע — הרשימה בלי ההודעות האחרונות.</p>}

      <div className="overflow-hidden rounded-card bg-card">
        {waiting.length > 0 && <p className="px-4 pb-1 pt-3 text-[12px] font-extrabold text-ink-400">ממתינים לתשובה</p>}
        {waiting.map((r) => <ConvRow key={r.athleteId} row={r} data={data} onOpen={onOpen} />)}
        {waiting.length > 0 && recent.length > 0 && <p className="px-4 pb-1 pt-3 text-[12px] font-extrabold text-ink-400">אחרונות</p>}
        {recent.map((r) => <ConvRow key={r.athleteId} row={r} data={data} onOpen={onOpen} />)}
        {!waiting.length && !recent.length && (
          <p className="py-6 text-center text-xs text-ink-400">{query || filter !== 'all' ? 'אין שיחות שמתאימות.' : 'אין מתאמנים באקדמיה.'}</p>
        )}
      </div>

      <NewChatSheet open={picking} onOpenChange={setPicking} rows={data.rows}
        onPick={(id) => { setPicking(false); onOpen?.(id); }} />
    </div>
  );
}

function ConvRow({ row, data, onOpen }: { row: ChatRow; data: ChatPayload; onOpen?: (athleteId: string) => void }) {
  const unread = row.unreadCount > 0;
  const owed = row.reason === 'awaiting_reply';
  const preview = chatPreview(row, data.viewerId ?? null, data.viewerGender);
  const quietDays = row.reason === 'silent' && row.quietDays != null ? Math.round(row.quietDays) : null;
  return (
    <button type="button" onClick={() => onOpen?.(row.athleteId)}
      className="flex w-full items-center gap-3 ps-4 text-right active:bg-page/60">
      <ChatAvatar row={row} />
      {/* WhatsApp's row: the line under the text, not under the photo. */}
      <div className="min-w-0 flex-1 border-b-[0.5px] border-black/[0.08] py-3 pe-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className={cn('truncate text-[16px] text-ink-900', unread || owed ? 'font-extrabold' : 'font-semibold')} dir="auto">{row.name}</span>
          <time className={cn('shrink-0 text-[13px]', unread ? 'font-bold text-[#16a34a]' : 'text-ink-400')}>{chatTimeLabel(row.lastAt)}</time>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className={cn('truncate text-[14px]', unread ? 'font-semibold text-ink-900' : 'text-ink-400')} dir="auto">
            {preview.mine && <b className={cn('me-1 font-bold', row.seenByTrainee ? 'text-[#2f8fdb]' : 'text-ink-400')}>{row.seenByTrainee ? '✓✓' : '✓'}</b>}
            {preview.text}
          </span>
          {unread ? (
            <span className="flex h-[21px] min-w-[21px] shrink-0 items-center justify-center rounded-full bg-[#16a34a] px-1.5 text-[12px] font-extrabold text-white tabular-nums">{row.unreadCount}</span>
          ) : owed ? (
            <span className="shrink-0 rounded-md bg-accent-red/10 px-1.5 py-0.5 text-[11px] font-extrabold text-accent-red-ink">ממתין</span>
          ) : quietDays != null ? (
            <span className="shrink-0 rounded-md bg-page px-1.5 py-0.5 text-[11px] font-bold text-ink-500">שקט <bdi dir="ltr">{quietDays}</bdi> ימים</span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

/** "✏️ שיחה חדשה": the caller's trainees (the inbox's own scoping), never-written first. */
function NewChatSheet({ open, onOpenChange, rows, onPick }: {
  open: boolean; onOpenChange: (o: boolean) => void; rows: ChatRow[]; onPick: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const match = (r: ChatRow) => !q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase());
  const fresh = rows.filter((r) => !hasThread(r) && match(r)).sort((a, b) => a.name.localeCompare(b.name, 'he'));
  const all = rows.filter((r) => hasThread(r) && match(r)).sort((a, b) => Date.parse(b.lastAt!) - Date.parse(a.lastAt!));
  const item = (r: ChatRow, cta: string, sub: string) => (
    <button key={r.athleteId} type="button" onClick={() => onPick(r.athleteId)}
      className="flex min-h-[56px] w-full items-center gap-3 px-1 py-1.5 text-right">
      <ChatAvatar row={r} size={44} />
      <span className="min-w-0 flex-1">
        <b className="block truncate text-[15px] text-ink-900" dir="auto">{r.name}</b>
        <small className="block text-[12.5px] text-ink-400">{sub}</small>
      </span>
      <span className="text-[13px] font-extrabold text-brand-600">{cta}</span>
    </button>
  );
  return (
    <Sheet open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setQ(''); }} title="שיחה חדשה">
      <div className="space-y-2 px-4 pb-6" dir="rtl">
        <label className="flex min-h-[40px] items-center gap-2 rounded-xl bg-page px-3 text-ink-400">
          <Search className="h-4 w-4 shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="שם מתאמן" aria-label="שם מתאמן"
            className="min-h-[40px] flex-1 bg-transparent text-base text-ink-900 placeholder:text-ink-400 focus:outline-none" />
        </label>
        {fresh.length > 0 && <p className="pt-1 text-[12px] font-extrabold text-ink-400">בלי שיחה עדיין</p>}
        {fresh.map((r) => item(r, 'לכתוב', r.coachNames?.length ? `מאמן: ${r.coachNames.join(', ')}` : 'עוד לא נכתבה הודעה'))}
        {all.length > 0 && <p className="pt-1 text-[12px] font-extrabold text-ink-400">כל המתאמנים שלי</p>}
        {all.map((r) => item(r, 'לפתוח', `הודעה אחרונה ${chatTimeLabel(r.lastAt)}`))}
      </div>
    </Sheet>
  );
}
