'use client';

import { useState } from 'react';
import { apiHeaders, useApi } from '@/lib/api';
import { CONTENT_TYPES, type ContentType } from '@/lib/content/hub';
import type { Draft } from '@/lib/access/drafts';

// ═════════════════════════════════════════════════════════════════════════════
// "מחכה לאישורך" at the top of Content (mockups/access-hub.html, stage 2): what a
// "מפרסם באישור" sent, for an approver to publish or turn down. Publishing replays the
// kept request as this admin (/api/admin/content/drafts). Nothing for anyone else:
// the read answers 403 to them and this draws nothing.
// ═════════════════════════════════════════════════════════════════════════════

export function useDrafts() {
  return useApi<{ drafts: Draft[] }>('/api/admin/content/drafts', { refreshInterval: 60_000, shouldRetryOnError: false });
}

const when = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()}.${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function DraftsWaiting() {
  const { data, mutate } = useDrafts();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const drafts = data?.drafts ?? [];
  if (!drafts.length) return msg ? <p role="status" className="rounded-[14px] bg-card px-3 py-2.5 text-13 font-bold text-ink-700">{msg}</p> : null;

  const act = async (d: Draft, action: 'approve' | 'reject') => {
    setBusy(d.id); setMsg(null);
    try {
      const res = await fetch('/api/admin/content/drafts', { method: 'POST', headers: await apiHeaders(true), body: JSON.stringify({ id: d.id, action }) });
      setMsg(res.ok ? (action === 'approve' ? `✓ פורסם · ${d.byName ?? ''} קיבל/ה התראה` : 'לא פורסם · נשלחה לו/ה התראה') : 'לא הצליח. אפשר לנסות שוב.');
      await mutate();
    } finally { setBusy(null); }
  };

  return (
    <section className="overflow-hidden rounded-[18px] bg-card">
      <p className="px-3.5 pb-1.5 pt-3 text-[15px] font-bold text-ink-900">מחכה לאישורך · {drafts.length}</p>
      {msg && <p role="status" className="mx-3.5 mb-2 rounded-[10px] bg-page px-3 py-2 text-13 font-bold text-ink-700">{msg}</p>}
      {drafts.map((d) => {
        const m = CONTENT_TYPES[d.kind as ContentType];
        return (
          <div key={d.id} className="mx-2.5 mb-2.5 rounded-[13px] px-3 py-2.5" style={{ background: m?.wash ?? '#f2f2f7' }}>
            <span className="block text-[11px] font-extrabold" style={{ color: m?.ink }}>{m?.label ?? d.kind} · {d.byName ?? '—'} · {when(d.at)}</span>
            <span dir="auto" className="mt-0.5 block text-[14px] font-semibold leading-snug text-ink-900">{d.title || '—'}</span>
            <span className="mt-2 flex gap-2">
              <button type="button" disabled={busy === d.id} onClick={() => void act(d, 'approve')}
                className="min-h-[36px] rounded-full px-4 text-[13px] font-bold text-white disabled:opacity-50" style={{ background: m?.color ?? '#1525FF' }}>{busy === d.id ? '…' : 'לפרסם'}</button>
              <button type="button" disabled={busy === d.id} onClick={() => void act(d, 'reject')}
                className="min-h-[36px] rounded-full bg-white px-4 text-[13px] font-bold text-ink-500 disabled:opacity-50">לא עכשיו</button>
            </span>
          </div>
        );
      })}
    </section>
  );
}
