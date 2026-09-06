'use client';

import { useMemo, useState } from 'react';
import { Check, X, Clock, Mail, RefreshCw, Search, ShieldAlert, Users } from 'lucide-react';
import { Card, LoadingBlock, ConfirmSheet, SegmentedControl } from '@/components/ui';
import { apiHeaders, useApi } from '@/lib/api';
import { cn, resolveGroup } from '@/lib/utils';

/**
 * The public /register approval queue — "who is waiting, and should they be in?".
 *
 * Lives here rather than in a page of its own because its home is
 * Settings → הרשמות (`/dashboard/settings?tab=registrations`), and the
 * standalone /dashboard/registrations URL (which the admin notification email
 * still links to) just redirects there. One surface, one implementation.
 *
 * ── BUILT FOR THIRTY-PLUS AT ONCE ───────────────────────────────────────────
 * This used to be one tall card per person, which is fine for three and unusable
 * for thirty — and thirty is the real number, because the whole club signs up in
 * the day after the link goes out. So: fixed-height rows in one grouped card,
 * multi-select with a bulk approve, and a search box, all sized so a screenful is
 * eight or nine people instead of two. If you add anything to a row, take the
 * height back out somewhere else.
 *
 * Reject is still behind a confirm sheet — a mis-tap there is not recoverable
 * from this screen — but approve is not, because approving is the expected
 * outcome and confirming thirty of them individually is the thing we just fixed.
 */

interface Registration {
  id: string;
  email: string;
  groupId: string | null;
  groupName: string | null;
  /** 'member' = submitted the public form but already had an account. A record,
   *  never a task: it has no approver, no rejecter and no action (migration 089). */
  status: 'pending' | 'approved' | 'rejected' | 'member';
  createdAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  rejectedAt: string | null;
  rejectedBy: string | null;
}

interface GroupOption {
  id: string;
  name: string;
  /** 1-based band number for the chip face; falls back to list position. */
  band: number;
}

/** The SWR key the pending queue reads. Exported so the Settings landing badge
 *  shares this exact request instead of firing a second one. */
export const PENDING_REGISTRATIONS_KEY = '/api/admin/registrations?status=pending';

/** Number of people waiting, for a badge. `null` while unknown (or not allowed). */
export function usePendingRegistrationsCount(enabled: boolean): number | null {
  const { data } = useApi<{ requests?: Registration[] }>(enabled ? PENDING_REGISTRATIONS_KEY : null);
  if (!data?.requests) return null;
  return data.requests.filter(r => r.status === 'pending').length;
}

/** "לפני 3 שעות" — how long someone has been waiting is the actionable part, and
 *  at this row height it is the only timestamp there is room for. */
function waitingFor(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `לפני ${mins} דק׳`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `לפני ${hours} שע׳`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'לפני יום' : `לפני ${days} ימים`;
}

/** The approve route's failure codes, in the language of this screen. Anything
 *  else is passed through — a message we didn't anticipate beats a generic one. */
function errorText(code: string): string {
  if (code === 'group-required') return 'צריך לשייך דבוקה לפני אישור.';
  if (code === 'group-invalid') return 'הדבוקה שנבחרה לא נמצאה. שווה לרענן ולנסות שוב.';
  return code || 'הפעולה נכשלה';
}

/** The small grey caption above a grouped card — the iOS section-header idiom. */
function SectionCaption({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn('px-2 mb-1.5 text-3xs font-semibold uppercase tracking-[0.09em] text-ink-400', className)}>
      {children}
    </p>
  );
}

export default function RegistrationsQueue() {
  const [tab, setTab] = useState<'pending' | 'all'>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [confirmReject, setConfirmReject] = useState<Registration | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Progress of a bulk run, so thirty sequential requests are not a frozen
  // screen. null when nothing is running.
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  // Group choices the approver has made but not yet committed, keyed by request
  // id. Applied by Approve, so changing the group and approving is one action
  // rather than two round trips.
  const [override, setOverride] = useState<Record<string, string>>({});

  // Server-verified, unlike the old localStorage canApprove() guess: the same
  // /api/auth/me the rest of the admin UI reads, so it can't be faked by
  // editing localStorage, and it matches what the two routes below enforce.
  const { data: meData, isLoading: meLoading } = useApi<{ canApprove?: boolean }>('/api/auth/me');
  const allowed = !!meData?.canApprove;

  const { data, isLoading, mutate } = useApi<{
    requests?: Registration[];
    migrated?: boolean;
    error?: string;
  }>(allowed ? `/api/admin/registrations?status=${tab}` : null);

  const { data: groupsData } = useApi<{ groups?: Array<{ id: string; name: string }> }>(
    allowed ? '/api/groups' : null,
  );

  // The chips are numbered 1/2/3 because that is what the club says out loud.
  // resolveGroup() is the one place that maps a stored name to its band, so the
  // numbers here can't drift from the rest of the app.
  const groups: GroupOption[] = useMemo(
    () => (groupsData?.groups || []).map((g, i) => {
      const idx = resolveGroup(g.name).index;
      return { id: g.id, name: g.name, band: idx >= 0 ? idx + 1 : i + 1 };
    }),
    [groupsData],
  );

  // Memoised for the `visible` filter below: a fresh `|| []` every render makes
  // that useMemo recompute on every keystroke anywhere in the tree.
  const requests = useMemo(() => data?.requests || [], [data]);

  /** The group that WOULD be sent for this row: the approver's pick if they made
   *  one, otherwise what the applicant submitted. '' means none, which is the
   *  state the approve route rejects. */
  const effectiveGroup = (r: Registration) => (r.id in override ? override[r.id] : r.groupId || '');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? requests.filter(r => r.email.toLowerCase().includes(q)) : requests;
  }, [requests, query]);

  const pending = visible.filter(r => r.status === 'pending');
  const pendingCount = requests.filter(r => r.status === 'pending').length;
  const missingGroupCount = requests.filter(r => r.status === 'pending' && !effectiveGroup(r)).length;

  const selectedRows = pending.filter(r => selected.has(r.id));
  const blockedRows = selectedRows.filter(r => !effectiveGroup(r));
  const allSelected = pending.length > 0 && selectedRows.length === pending.length;

  const toggle = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(pending.map(r => r.id)));

  /** One approve/reject round trip. Returns whether the mail went out, so the
   *  bulk caller can report on the whole run instead of per row. */
  const call = async (r: Registration, action: 'approve' | 'reject'): Promise<{ emailed: boolean }> => {
    const body: Record<string, unknown> = { id: r.id, action };
    // Always explicit on approve. The route treats a missing key as "keep what
    // was submitted", and this screen always knows better than that — the chips
    // are the answer to the same question.
    if (action === 'approve') body.groupId = effectiveGroup(r) || null;
    // The bearer token is not optional: /api/admin/registrations/approve runs
    // behind requireSession, so a plain fetch() here 401s and every approval
    // silently fails.
    const res = await fetch('/api/admin/registrations/approve', {
      method: 'POST',
      headers: await apiHeaders(true),
      body: JSON.stringify(body),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(errorText(out.error));
    return { emailed: out.emailed !== false };
  };

  const act = async (r: Registration, action: 'approve' | 'reject') => {
    // Never fire an approve for a row with no group: the route would 400 and the
    // reader would get an error for something the screen already knew.
    if (action === 'approve' && !effectiveGroup(r)) {
      setError(errorText('group-required'));
      return;
    }
    setBusyId(r.id);
    setError(null);
    setNote(null);
    try {
      const { emailed } = await call(r, action);
      // emailed:false means the approval went through but Resend didn't — the
      // person is in and does NOT know it. Worth saying out loud, because the
      // fix is a human one (send them the link yourself).
      if (action === 'approve' && !emailed) {
        setNote('אושר — אבל שליחת המייל נכשלה. הם בפנים ולא יודעים על זה. צריך לשלוח את הקישור ידנית.');
      }
      setSelected(prev => { const n = new Set(prev); n.delete(r.id); return n; });
      await mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'הפעולה נכשלה');
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Bulk approve, one request at a time on purpose.
   *
   * Every approval sends an email, so thirty of them in a Promise.all is thirty
   * concurrent Resend calls — rate-limited somewhere in the middle, leaving a
   * run half-done with no record of where it stopped. Sequential is slower and
   * survivable: it stops at the first failure with everything before it
   * committed, and the queue reloads to show exactly that.
   */
  const approveSelected = async () => {
    const targets = selectedRows;
    if (!targets.length || blockedRows.length) return;
    setError(null);
    setNote(null);
    setBulk({ done: 0, total: targets.length });
    let failedAt: string | null = null;
    const noMail: string[] = [];
    for (let i = 0; i < targets.length; i++) {
      try {
        const { emailed } = await call(targets[i], 'approve');
        if (!emailed) noMail.push(targets[i].email);
        setBulk({ done: i + 1, total: targets.length });
      } catch (err) {
        failedAt = err instanceof Error ? err.message : 'הפעולה נכשלה';
        setError(`${failedAt} — נעצר אחרי ${i} מתוך ${targets.length}.`);
        break;
      }
    }
    if (noMail.length) {
      setNote(
        `${noMail.length} אושרו אבל המייל אליהם נכשל. הם בפנים ולא יודעים על זה — צריך לשלוח להם את הקישור ידנית: ${noMail.join(', ')}`,
      );
    }
    setBulk(null);
    setSelected(new Set());
    await mutate();
  };

  /** Assign one group to everything currently selected, in local state only —
   *  committed by the approve that follows. */
  const assignAllSelected = (groupId: string) =>
    setOverride(prev => {
      const next = { ...prev };
      for (const r of selectedRows) next[r.id] = groupId;
      return next;
    });

  if (meLoading) return <LoadingBlock tone="ink" />;

  if (!allowed) {
    return (
      <Card className="p-6 text-center max-w-md mx-auto">
        <ShieldAlert className="h-10 w-10 text-ink-400 mx-auto mb-3" />
        <h2 className="text-base font-bold text-ink-700">האזור הזה לא זמין לך</h2>
        <p className="text-ink-400 text-sm mt-2">אישור הרשמות מוגבל לחשבונות המאמן והמנהל.</p>
      </Card>
    );
  }

  return (
    <div dir="rtl">
      <ConfirmSheet
        open={!!confirmReject}
        onOpenChange={(o) => { if (!o) setConfirmReject(null); }}
        title="לדחות את ההרשמה?"
        description={
          confirmReject
            ? `${confirmReject.email} לא יקבל שום מייל, ולא ייווצר לו חשבון. אפשר להירשם מחדש.`
            : undefined
        }
        confirmLabel="דחייה"
        cancelLabel="ביטול"
        onConfirm={() => {
          const target = confirmReject;
          setConfirmReject(null);
          if (target) void act(target, 'reject');
        }}
      />

      {/* Large-title header, iOS nav-bar shaped: the count is the headline, because
          "how many are waiting" is why anyone opens this tab. */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-extrabold text-ink-900 leading-tight">בקשות הרשמה</h2>
          <p className="mt-0.5 text-xs">
            <span className="font-semibold text-ink-900">
              {pendingCount === 0 ? 'אין הרשמות שממתינות' : `${pendingCount} ממתינות לאישור`}
            </span>
            {missingGroupCount > 0 && <span className="text-ink-400"> · {missingGroupCount} ללא דבוקה</span>}
          </p>
        </div>
        <button
          onClick={() => mutate()}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-ink-400 active:bg-page/60"
          aria-label="רענון"
        >
          <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
        </button>
      </div>

      {/* activeBg overridden to ink: this screen is mono, and the default brand
          blue would be the only colour on it. */}
      <SegmentedControl
        className="mt-3"
        value={tab}
        onChange={(v) => { setTab(v); setSelected(new Set()); }}
        options={[
          { value: 'pending' as const, label: `ממתינות · ${pendingCount}`, icon: Clock, activeBg: 'bg-ink-900' },
          { value: 'all' as const, label: 'הכל', icon: Users, activeBg: 'bg-ink-900' },
        ]}
      />

      <div className="mt-2.5 flex items-center gap-2 h-10 px-3 rounded-2xl bg-page">
        <Search className="h-4 w-4 shrink-0 text-ink-400" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          dir="ltr"
          inputMode="email"
          placeholder="חיפוש לפי אימייל"
          aria-label="חיפוש לפי אימייל"
          className="flex-1 bg-transparent border-0 p-0 text-sm text-ink-900 placeholder-ink-400 text-right focus:outline-none focus:ring-0 placeholder:text-right"
        />
        {query && (
          <button onClick={() => setQuery('')} className="text-ink-400 shrink-0" aria-label="ניקוי החיפוש">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Migrations here are applied by hand, so "the table isn't there yet" is a
          real state a reader of this screen can hit — and it is not an error they
          should have to decode from an empty list. */}
      {data?.migrated === false && (
        <Card className="mt-3 p-4">
          <p className="text-sm text-ink-900 font-semibold">הטבלה עוד לא נוצרה</p>
          <p className="text-ink-400 text-xs mt-1 leading-relaxed">
            צריך להריץ את <code dir="ltr">supabase/migrations/083_signup_requests.sql</code> ב-Supabase SQL editor.
          </p>
        </Card>
      )}

      {error && <p className="mt-3 text-sm text-accent-red leading-relaxed">{error}</p>}
      {/* Kept loud and specific: this is the one outcome where the screen says
          "done" and a person is left stranded. */}
      {note && <p className="mt-3 text-sm font-semibold text-accent-red leading-relaxed">{note}</p>}

      {isLoading && requests.length === 0 && <LoadingBlock tone="ink" />}

      {!isLoading && requests.length === 0 && data?.migrated !== false && (
        <Card className="mt-3 p-6 text-center">
          <Mail className="h-9 w-9 text-ink-400 mx-auto mb-2" />
          <p className="text-sm text-ink-500">אין כאן כלום כרגע.</p>
          <p className="text-ink-400 text-xs mt-1">
            הקישור לשיתוף: <code dir="ltr">/register</code>
          </p>
        </Card>
      )}

      {!isLoading && requests.length > 0 && visible.length === 0 && (
        <p className="mt-4 text-center text-sm text-ink-500">אין תוצאות ל-<span dir="ltr">{query}</span></p>
      )}

      {pending.length > 0 && (
        <div className="mt-4">
          <SectionCaption>בחירה</SectionCaption>
          <div className="rounded-card bg-card overflow-hidden shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
            <button onClick={toggleAll} className="w-full flex items-center gap-2.5 h-12 px-4 text-right active:bg-page/40">
              <SelectMark state={allSelected ? 'on' : selectedRows.length ? 'some' : 'off'} />
              <span className="flex-1 text-13 font-medium text-ink-900">
                {allSelected ? 'בטל את הבחירה' : 'בחר הכל'}
              </span>
              <span className="text-3xs text-ink-400">{selectedRows.length} מתוך {pending.length} נבחרו</span>
            </button>
          </div>
        </div>
      )}

      {visible.length > 0 && (
        <div className="mt-4">
          <div className="flex items-baseline justify-between">
            <SectionCaption className="mb-0">
              {tab === 'pending' ? `ממתינות לאישור · ${pending.length}` : `כל ההרשמות · ${visible.length}`}
            </SectionCaption>
            {pending.length > 0 && <span className="px-2 text-3xs text-ink-400">אין אישור בלי דבוקה</span>}
          </div>
          {/* One grouped card for the whole list, hairlines between rows — thirty
              separate cards is thirty shadows and thirty gaps, which is what made
              this unreadable. */}
          <div className="mt-1.5 rounded-card bg-card overflow-hidden shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
            {visible.map((r, i) => (
              <QueueRow
                key={r.id}
                r={r}
                groups={groups}
                last={i === visible.length - 1}
                selected={selected.has(r.id)}
                busy={busyId === r.id || !!bulk}
                groupId={effectiveGroup(r)}
                onToggle={() => toggle(r.id)}
                onPickGroup={(gid) => setOverride(prev => ({ ...prev, [r.id]: gid }))}
                onApprove={() => act(r, 'approve')}
                onReject={() => setConfirmReject(r)}
              />
            ))}
          </div>
          {pending.length > 0 && (
            <p className="mt-2.5 px-2 text-3xs text-ink-400 leading-relaxed">
              אישור יוצר את המשתמש ושולח לו מייל עם קישור להשלמת ההרשמה. שורות עם פס שחור ממתינות
              לשיוך דבוקה — האישור בהן חסום.
            </p>
          )}
        </div>
      )}

      {/* The bulk bar, iOS bottom-action shaped. Sticky so it stays reachable
          however far down the list the reader has scrolled — with thirty rows the
          selection is usually made well below the fold.

          Offset by the BottomTabBar's 72px (plus the home-indicator inset), not
          `bottom-0`: this screen lives inside the (app) shell, whose tab bar is
          `fixed`, so a bar flush to the viewport bottom put the approve button
          UNDERNEATH it — selectable rows, visible count, unreachable action. Same
          72px convention as PushOptIn. On md the tab bar is gone, so it isn't. */}
      {selectedRows.length > 0 && (
        <div className="sticky bottom-[calc(72px+env(safe-area-inset-bottom))] md:bottom-0 z-20 mt-4 -mx-1 px-4 pt-3 pb-4 rounded-t-card bg-card/95 backdrop-blur border-t border-page">
          <div className="flex items-center justify-between">
            <span className="text-13 font-semibold text-ink-900">
              {bulk ? `מאשר… ${bulk.done} מתוך ${bulk.total}` : `${selectedRows.length} נבחרו`}
            </span>
            {!bulk && (
              <button onClick={() => setSelected(new Set())} className="text-3xs text-ink-400">
                ביטול בחירה
              </button>
            )}
          </div>

          {blockedRows.length > 0 && !bulk && (
            <>
              <p className="mt-1 flex items-center gap-1.5 text-3xs font-semibold text-ink-900">
                <span className="w-1.5 h-1.5 rounded-full bg-ink-900" aria-hidden="true" />
                {blockedRows.length} מהנבחרים ללא דבוקה — לא ניתן לאשר
              </p>
              <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                <span className="text-3xs text-ink-500 shrink-0">שייך את כל הנבחרים ל…</span>
                {groups.map(g => (
                  <button
                    key={g.id}
                    onClick={() => assignAllSelected(g.id)}
                    className="h-[30px] min-w-[38px] px-2.5 rounded-pill bg-card border border-ink-900/20 text-13 font-semibold text-ink-900 active:bg-page"
                  >
                    דבוקה {g.band}
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => { const first = selectedRows[0]; if (first) setConfirmReject(first); }}
              disabled={!!bulk}
              className="w-11 h-11 shrink-0 rounded-full bg-card border border-ink-300/60 text-accent-red flex items-center justify-center disabled:opacity-40"
              aria-label="דחייה"
            >
              <X className="h-4 w-4" />
            </button>
            <button
              onClick={approveSelected}
              disabled={!!bulk || blockedRows.length > 0}
              className={cn(
                'flex-1 h-11 rounded-pill text-sm font-semibold transition-colors',
                blockedRows.length > 0 || bulk
                  ? 'bg-page text-ink-400'
                  : 'bg-ink-900 text-white active:bg-ink-700',
              )}
            >
              {bulk
                ? `מאשר… ${bulk.done}/${bulk.total}`
                : `אישור ${selectedRows.length} בקשות ושליחת קישור במייל`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** iOS-style selection mark: a hollow circle, a filled tick, or a dash for
 *  "some but not all" — a full tick at 4-of-33 would be a lie. */
function SelectMark({ state }: { state: 'on' | 'off' | 'some' }) {
  return (
    <span
      className={cn(
        'w-[22px] h-[22px] shrink-0 rounded-full border flex items-center justify-center',
        state === 'on' ? 'bg-ink-900 border-ink-900 text-white' : 'border-ink-300 text-ink-900',
      )}
      aria-hidden="true"
    >
      {state === 'on' && <Check className="h-3 w-3" strokeWidth={3.5} />}
      {state === 'some' && <span className="w-2 h-[1.5px] bg-ink-900 rounded-full" />}
    </span>
  );
}

/**
 * One request. Fixed height and a single line of identity, because thirty of
 * these have to be scannable: email + how long they've waited on top, the group
 * chips and the actions underneath.
 *
 * No name anywhere — the public form never asks for one. It gets collected at
 * /join/{token} after approval, so until then the email IS the person.
 */
function QueueRow({
  r, groups, last, selected, busy, groupId, onToggle, onPickGroup, onApprove, onReject,
}: {
  r: Registration;
  groups: GroupOption[];
  last: boolean;
  selected: boolean;
  busy: boolean;
  groupId: string;
  onToggle: () => void;
  onPickGroup: (groupId: string) => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const isPending = r.status === 'pending';
  const needsGroup = isPending && !groupId;

  return (
    <div
      className={cn(
        'flex items-center gap-2.5 px-3.5 min-h-[62px]',
        !last && 'border-b border-page',
        selected && 'bg-page/40',
        // A black edge on the row's leading side. Eight of these down the list is
        // the "these are the ones blocking you" signal, and it survives being
        // glanced at, which a greyed-out button alone does not.
        needsGroup && 'shadow-[inset_-3px_0_0_0_#1D1E26]',
      )}
    >
      {isPending ? (
        <button onClick={onToggle} className="shrink-0 -my-2 py-2" aria-label={selected ? 'ביטול בחירה' : 'בחירה'}>
          <SelectMark state={selected ? 'on' : 'off'} />
        </button>
      ) : (
        <span className="w-[22px] shrink-0" aria-hidden="true" />
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span dir="ltr" className="text-13 font-medium text-ink-900 truncate text-left select-all">
            {r.email}
          </span>
          <span className="text-3xs text-ink-300 shrink-0" aria-hidden="true">·</span>
          <span className="text-3xs text-ink-400 shrink-0">{waitingFor(r.createdAt)}</span>
        </div>

        {isPending ? (
          <div className="mt-1 flex items-center gap-1.5">
            {/* The prompt replaces the "דבוקה" caption rather than sitting next to
                it: the row has to say what is missing, not just fail to say what
                is set. */}
            <span className={cn('shrink-0 whitespace-nowrap', needsGroup ? 'text-3xs font-bold text-ink-900' : 'text-3xs text-ink-400')}>
              {needsGroup ? 'בחר דבוקה' : 'דבוקה'}
            </span>
            {/* Three chips instead of a <select>: at this density a native picker
                is two taps and a modal per person, and the whole point is to get
                through thirty of them. */}
            <span className="flex gap-[3px] shrink-0">
              {groups.map(g => {
                const on = groupId === g.id;
                return (
                  <button
                    key={g.id}
                    onClick={() => onPickGroup(g.id)}
                    disabled={busy}
                    aria-pressed={on}
                    aria-label={`דבוקה ${g.band}`}
                    className={cn(
                      'w-[19px] h-[19px] rounded-[7px] text-3xs font-semibold flex items-center justify-center transition-colors',
                      on ? 'bg-ink-900 text-white' : 'bg-page text-ink-400',
                    )}
                  >
                    {g.band}
                  </button>
                );
              })}
            </span>
            {needsGroup && (
              <>
                <span className="text-3xs text-ink-300 shrink-0" aria-hidden="true">·</span>
                <span className="text-3xs text-ink-400 shrink-0 whitespace-nowrap">לא בטוח/ה</span>
              </>
            )}
          </div>
        ) : (
          <div className="mt-1 flex items-center gap-1.5">
            {/* Three faces, not two. 'member' is deliberately the quiet one — a
                flat grey chip rather than the black "אושר" or the red "נדחה":
                nobody did anything and nobody has to. It reads as a note in the
                margin, which is what it is. */}
            <span
              className={cn(
                'text-3xs font-bold px-1.5 py-0.5 rounded',
                r.status === 'approved' && 'bg-ink-900 text-white',
                r.status === 'rejected' && 'bg-accent-red/15 text-accent-red-ink',
                r.status === 'member' && 'bg-page text-ink-400',
              )}
            >
              {r.status === 'approved' ? 'אושר' : r.status === 'rejected' ? 'נדחה' : 'כבר חבר'}
            </span>
            <span className="text-3xs text-ink-400 truncate">
              {r.status === 'member' ? 'נרשם מהקישור, יש לו כבר חשבון' : r.groupName || 'ללא דבוקה'}
              {r.status === 'approved' && r.approvedBy && ` · ${r.approvedBy}`}
              {r.status === 'rejected' && r.rejectedBy && ` · ${r.rejectedBy}`}
            </span>
          </div>
        )}
      </div>

      {isPending && (
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={onReject}
            disabled={busy}
            className="w-7 h-7 rounded-full bg-page text-ink-400 flex items-center justify-center disabled:opacity-40"
            aria-label="דחייה"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          {/* Outlined, not filled: thirty solid black pills down a white card is a
              wall, and the only filled button on the screen should be the bulk
              one. Disabled is the real state here, not a decoration — the route
              400s on a missing group, so the row must not offer the tap. */}
          <button
            onClick={onApprove}
            disabled={busy || needsGroup}
            title={needsGroup ? 'צריך לשייך דבוקה לפני אישור' : undefined}
            className={cn(
              'h-7 px-3 rounded-pill text-2xs font-semibold transition-colors',
              needsGroup
                ? 'bg-page/70 text-ink-300 border border-page'
                : 'bg-card border border-ink-900/25 text-ink-900 active:bg-page',
              busy && !needsGroup && 'opacity-50',
            )}
          >
            אשר
          </button>
        </div>
      )}
    </div>
  );
}
