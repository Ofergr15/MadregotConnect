'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ChevronRight, Plus } from 'lucide-react';
import { useApi } from '@/lib/api';
import { ConfirmSheet, EmptyState } from '@/components/ui';
import { agoHe, LIVE_MS, POLL_MS, RESTORE_MS, UNDO_MS, mayEdit } from '@/lib/club-updates/model';
import type { ClubUpdate } from '@/lib/club-updates/server';
import { UpdatePost } from '@/components/club-updates/UpdatePost';
import { UpdateComposer, type ComposerValue } from '@/components/club-updates/UpdateComposer';
import { UpdateMenu } from '@/components/club-updates/UpdateMenu';
import { deleteUpdate, editUpdate, publishUpdate, reactTo, type StreamResponse } from '@/components/club-updates/api';
import { dayLabel, dayOf } from '@/components/club-updates/format';
import '@/components/club-updates/club-updates.css';

// ═════════════════════════════════════════════════════════════════════════════
// "עדכונים מהמועדון" — the stream (mockup ~/.cache/madregot/club-updates/full-mockup.html,
// screens 4–12). Newest first, pinned on top, a timeline per day. Members read and react;
// the writers the admin chose also write, edit and delete their own; the admin all.
// New updates wait behind "N עדכונים חדשים ↑" instead of moving the page under a reader.
// ═════════════════════════════════════════════════════════════════════════════

interface Toast { text: string; action?: { label: string; run: () => void }; ms: number }

function Stream() {
  const params = useSearchParams();
  const focus = params.get('u');
  const { data, mutate } = useApi<StreamResponse>('/api/club-updates', { refreshInterval: POLL_MS });
  const [shown, setShown] = useState<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [composer, setComposer] = useState<{ open: boolean; editing: ClubUpdate | null }>({ open: false, editing: null });
  const [menu, setMenu] = useState<ClubUpdate | null>(null);
  const [confirmDel, setConfirmDel] = useState<ClubUpdate | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const all = useMemo(() => data?.updates ?? [], [data]);
  // The first answer is what the reader sees; later arrivals queue behind the pill.
  useEffect(() => { if (data && !shown) setShown(new Set(all.map((u) => u.id))); }, [data, all, shown]);
  const pending = shown ? all.filter((u) => !shown.has(u.id)) : [];
  const visible = shown ? all.filter((u) => shown.has(u.id)) : all;
  const pinned = visible.filter((u) => u.pinned);
  const rest = visible.filter((u) => !u.pinned);

  const reveal = useCallback((ids: string[]) => {
    setShown((s) => new Set([...(s ?? []), ...ids]));
    setFresh(new Set(ids));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Opened from a push: straight to that update.
  useEffect(() => {
    if (!focus || !shown) return;
    if (!shown.has(focus) && all.some((u) => u.id === focus)) setShown((s) => new Set([...(s ?? []), focus]));
    const t = setTimeout(() => document.getElementById(`u-${focus}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250);
    return () => clearTimeout(t);
  }, [focus, shown, all]);

  const say = (t: Toast) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), t.ms);
  };

  const replace = (u: ClubUpdate) => mutate((d) => d && { ...d, updates: d.updates.map((x) => (x.id === u.id ? u : x)) }, { revalidate: false });

  const submit = async (v: ComposerValue) => {
    if (composer.editing) {
      const { update } = await editUpdate(composer.editing.id, v);
      replace(update);
      say({ text: 'נשמר', ms: 2200 });
      return;
    }
    const { update, push } = await publishUpdate(v);
    setShown((s) => new Set([...(s ?? []), update.id]));
    setFresh(new Set([update.id]));
    await mutate((d) => d && { ...d, updates: [update, ...d.updates] }, { revalidate: false });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    say({
      text: push ? (update.breaking ? 'פורסם · ההתראה יוצאת עוד רגע' : 'פורסם · מי שתויג יקבל התראה') : 'פורסם',
      ms: UNDO_MS,
      action: { label: 'ביטול', run: async () => {
        setToast(null);
        await deleteUpdate(update.id).catch(() => null);
        await mutate();
        say({ text: push ? 'בוטל — ההתראה לא נשלחה' : 'בוטל', ms: 2400 });
      } },
    });
  };

  const react = async (u: ClubUpdate, emoji: string) => {
    // Optimistic: the pill moves under the finger, the answer corrects it.
    const had = u.reactions.find((r) => r.emoji === emoji);
    const next = had
      ? u.reactions.map((r) => (r.emoji === emoji ? { ...r, count: r.count + (r.mine ? -1 : 1), mine: !r.mine } : r)).filter((r) => r.count > 0)
      : [...u.reactions, { emoji, count: 1, mine: true }];
    replace({ ...u, reactions: next });
    try { replace((await reactTo(u.id, emoji)).update); } catch { replace(u); }
  };

  const doDelete = async (u: ClubUpdate) => {
    setConfirmDel(null);
    try {
      await deleteUpdate(u.id);
      await mutate((d) => d && { ...d, updates: d.updates.filter((x) => x.id !== u.id) }, { revalidate: false });
      say({ text: 'העדכון נמחק', ms: RESTORE_MS, action: { label: 'שחזור', run: async () => {
        setToast(null);
        await editUpdate(u.id, { restore: true }).catch(() => null);
        await mutate();
      } } });
    } catch { say({ text: 'לא הצלחנו למחוק', ms: 2400 }); }
  };

  const me = data?.me ?? null;
  const access = { admin: !!data?.admin, canWrite: !!data?.canWrite, canRead: true };
  const newest = all[0]?.createdAt;
  const live = newest ? now - Date.parse(newest) < LIVE_MS : false;
  let lastDay = '';
  const today = dayOf(new Date(now).toISOString());

  return (
    <div className="cu -mx-4 -mt-5 min-h-[100dvh] bg-page pb-32" dir="rtl">
      <header className="cu-hero px-4 pb-4 pt-3">
        <span className="cu-stairs" aria-hidden />
        <div className="relative flex items-center justify-between">
          <Link href="/feed" aria-label="חזרה לפיד" className="flex h-11 w-11 items-center justify-center rounded-full bg-page text-ink-900"><ChevronRight className="h-5 w-5" /></Link>
          <span className="cu-wm" aria-hidden />
        </div>
        <h1 className="relative mt-3 text-[26px] font-black text-ink-900">עדכונים מהמועדון</h1>
        {newest && (
          <div className="relative mt-0.5 flex items-center gap-2 text-[12.5px] text-ink-400">
            {live && <span className="cu-live-pill"><span className="cu-dot" />חי</span>}
            עודכן {agoHe(newest, now)}
          </div>
        )}
      </header>

      {data?.admin && (!data.enabled || data.missing) && (
        <Link href="/dashboard/club-updates" className="mx-3 mt-3 block rounded-2xl bg-[#FFF1D6] px-4 py-3 text-[13px] font-bold text-[#8A5A00]">
          {data.missing ? 'צריך להריץ את מיגרציה 154 לפני שאפשר לכתוב ›' : 'כבוי לחברים — רק אתה רואה את זה. להפעלה ולבחירת מי כותב ›'}
        </Link>
      )}

      <div className="relative px-3 pt-3">
        {pending.length > 0 && (
          <button type="button" onClick={() => reveal(pending.map((u) => u.id))}
            className="sticky top-[calc(env(safe-area-inset-top)+8px)] z-20 mx-auto mb-2 flex min-h-[40px] items-center rounded-pill bg-brand-600 px-4 text-[12.5px] font-extrabold text-white shadow-[0_8px_18px_-6px_rgba(21,37,255,.8)]">
            {pending.length === 1 ? 'עדכון חדש ↑' : <><bdi>{pending.length}</bdi>&nbsp;עדכונים חדשים ↑</>}
          </button>
        )}

        {data && !data.enabled && !data.admin && <EmptyState title="אין עדכונים כרגע" />}
        {data && (data.enabled || data.admin) && visible.length === 0 && (
          <div className="mt-10 text-center">
            <p className="text-[15px] font-bold text-ink-700">עוד אין עדכונים</p>
            {access.canWrite && <p className="mt-1 text-[13px] text-ink-400">לחיצה על ＋ כותבת את הראשון</p>}
          </div>
        )}

        {pinned.map((u) => (
          <div key={u.id} className="cu-pin mb-3 px-1 pt-2">
            <p className="px-3 text-[10.5px] font-black text-brand-600">📌 נעוץ</p>
            <div className="cu-tl2 !ps-0 [&>article]:!shadow-none [&>article]:!bg-transparent [&>article::before]:hidden">
              <UpdatePost update={u} canEdit={mayEdit(access, me, u.author.id)} onReact={(e) => void react(u, e)} onMenu={() => setMenu(u)} highlight={u.id === focus} fresh={fresh.has(u.id)} />
            </div>
          </div>
        ))}

        <div className="cu-tl2">
          {rest.map((u) => {
            const d = dayOf(u.createdAt);
            const sep = d !== lastDay;
            lastDay = d;
            return (
              <div key={u.id}>
                {sep && (
                  <div className="-ms-[18px] mb-2.5 mt-1 flex items-center gap-2.5 text-[11.5px] font-extrabold text-ink-400 before:h-px before:flex-1 before:bg-[#D9D9E0] after:h-px after:flex-1 after:bg-[#D9D9E0]">
                    {dayLabel(d, today)}
                  </div>
                )}
                <UpdatePost update={u} canEdit={mayEdit(access, me, u.author.id)} onReact={(e) => void react(u, e)} onMenu={() => setMenu(u)} highlight={u.id === focus} fresh={fresh.has(u.id)} />
              </div>
            );
          })}
        </div>
      </div>

      {access.canWrite && !data?.missing && (
        <button type="button" className="cu-fab" aria-label="עדכון חדש" onClick={() => setComposer({ open: true, editing: null })}>
          <Plus className="h-7 w-7" />
        </button>
      )}

      <UpdateComposer open={composer.open} onOpenChange={(open) => setComposer((c) => ({ ...c, open }))} me={me} editing={composer.editing} onSubmit={submit} />
      <UpdateMenu
        update={menu}
        onClose={() => setMenu(null)}
        onEdit={() => { const u = menu; setMenu(null); setComposer({ open: true, editing: u }); }}
        onPin={async () => { const u = menu!; setMenu(null); replace((await editUpdate(u.id, { pinned: !u.pinned })).update); }}
        onBreaking={async () => { const u = menu!; setMenu(null); replace((await editUpdate(u.id, { breaking: !u.breaking })).update); }}
        onCopy={async () => {
          const u = menu!; setMenu(null);
          try { await navigator.clipboard.writeText(`${window.location.origin}/updates?u=${u.id}`); say({ text: 'הקישור הועתק', ms: 2000 }); } catch { /* */ }
        }}
        onDelete={() => { const u = menu; setMenu(null); setConfirmDel(u); }}
      />
      <ConfirmSheet
        open={!!confirmDel}
        onOpenChange={(o) => { if (!o) setConfirmDel(null); }}
        title="למחוק את העדכון?"
        description="הוא יורד מהזרם ומהפיד, יחד עם התגובות. התראה שכבר נשלחה נשארת אצל מי שקיבל אותה."
        confirmLabel="מחיקה"
        cancelLabel="ביטול"
        onConfirm={() => { if (confirmDel) void doDelete(confirmDel); }}
      />

      {toast && (
        <div className="cu-toast" role="status">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#34c759] text-xs">✓</span>
          <span className="min-w-0 flex-1">{toast.text}</span>
          {toast.action && (
            <button type="button" onClick={toast.action.run} className="-my-2 min-h-[44px] px-2 font-black text-[#FFB08F]">{toast.action.label}</button>
          )}
          {toast.action && <span className="cu-bar" style={{ animationDuration: `${toast.ms}ms` }} />}
        </div>
      )}
    </div>
  );
}

export default function UpdatesPage() {
  return <Suspense fallback={null}><Stream /></Suspense>;
}
