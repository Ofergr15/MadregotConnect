'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronDown, Copy, MessageCircle, Send, X, Clock, Mail, RefreshCw, Search, ShieldAlert, Users } from 'lucide-react';
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
  /** Set when the address already has an athlete row — either because approval
   *  created one, or because they were already in the app before they ever reached
   *  this queue (the pre-launch backfill, and the public form's member branch).
   *  On a PENDING row it changes what approving means: no member is created, the
   *  existing row is adopted and the /join onboarding link is mailed. */
  athleteId: string | null;
  /** How far they actually got. Derived server-side from the athlete row — see
   *  stageOf() in the route. 'emailed' | 'connected' | 'done' for an approved row;
   *  otherwise the same value as `status`. */
  stage: Stage | 'pending' | 'rejected' | 'member';
  /** The name they typed at /join, once they have. Before that it is the
   *  placeholder derived from their address, so never treat it as progress. */
  athleteName: string | null;
  hasStrava: boolean;
  hasGarmin: boolean;
  /** Their invite link's token. A credential — see the route — so it is only ever
   *  used to build a link the approver hands to that one person. */
  inviteToken: string | null;
}

/** The three states an approved person passes through. Ordered, and that order is
 *  what the אושרו tab is sorted by. */
type Stage = 'emailed' | 'connected' | 'done';

const STAGES: Array<{ key: Stage; label: string; hint: string }> = [
  // The one that needs chasing, first. "Approved and nothing happened" is either a
  // mail that never arrived or a person who needs a nudge, and both are actions.
  { key: 'emailed', label: 'מייל נשלח', hint: 'קיבלו קישור ועוד לא נגעו בו' },
  { key: 'connected', label: 'בוצע חיבור', hint: 'התחילו — חסר להם Strava, ובלעדיו אין כניסה' },
  { key: 'done', label: 'סיימו חיבור', hint: 'בפנים, אפשר לשכוח מהם' },
];

interface GroupOption {
  id: string;
  name: string;
  /** 1-based band number for the chip face; falls back to list position. */
  band: number;
}

/**
 * The one SWR key this whole screen reads. Exported so the Settings landing badge
 * shares this exact request instead of firing a second one.
 *
 * `status=all`, not `pending`, since the tabs became three: the counts on all of
 * them have to be right while you are looking at any one of them, and re-fetching
 * per tab made the numbers appear one tab at a time. It is one small list — this
 * is a club, not a mailing list — so filtering in the browser is cheaper than
 * three round trips.
 */
export const PENDING_REGISTRATIONS_KEY = '/api/admin/registrations?status=all';

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
  if (code === 'not-approved') return 'אפשר לשלוח קישור מחדש רק למי שאושר.';
  return code || 'הפעולה נכשלה';
}

/**
 * Why a send failed, in words that point at the fix.
 *
 * `reason` is Resend's own `name: message` (see sendOrThrow in lib/email.ts). The
 * one worth naming explicitly is the sandbox sender: with no RESEND_FROM_EMAIL set,
 * mail goes out as `onboarding@resend.dev`, which Resend only delivers to the
 * address that owns the Resend account. Every applicant is "every other recipient",
 * so on the day the club signs up, nobody gets a link — and that is a config fix,
 * not something to retry.
 */
function mailFailureText(reason?: string | null): string {
  if (reason === 'email-not-configured') return 'שליחת מיילים לא מוגדרת בסביבה הזו (חסר RESEND_API_KEY).';
  const r = (reason || '').toLowerCase();
  if (r.includes('testing emails') || r.includes('own email address') || r.includes('domain')) {
    return 'Resend מסרב לשלוח לכתובת הזו: כתובת השולח היא onboarding@resend.dev, שמותרת רק לכתובת של בעל החשבון ב-Resend. צריך דומיין מאומת ו-RESEND_FROM_EMAIL.';
  }
  return `שליחת המייל נכשלה${reason ? ` (${reason})` : ''}.`;
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
  const [tab, setTab] = useState<'pending' | 'approved' | 'all'>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [confirmReject, setConfirmReject] = useState<Registration | null>(null);
  /** The row whose link was just copied, for a two-second "הועתק". */
  const [copiedId, setCopiedId] = useState<string | null>(null);
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
  }>(allowed ? PENDING_REGISTRATIONS_KEY : null);

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
    if (!q) return requests;
    // Name as well as address, now that approved rows carry one: after /join the
    // approver knows these people as "דנה" and not as an email local part.
    return requests.filter(
      r => r.email.toLowerCase().includes(q) || (r.athleteName || '').toLowerCase().includes(q),
    );
  }, [requests, query]);

  // One fetch serves three tabs, so the order is decided here rather than in SQL:
  // a worklist reads oldest-first (who has waited longest), a history reads
  // newest-first (what just happened).
  const pending = useMemo(
    () => visible.filter(r => r.status === 'pending')
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [visible],
  );
  const history = useMemo(
    () => visible.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [visible],
  );
  const approved = useMemo(
    () => history.filter(r => r.status === 'approved'),
    [history],
  );
  const pendingCount = requests.filter(r => r.status === 'pending').length;
  const approvedCount = requests.filter(r => r.status === 'approved').length;
  // The headline number of the אושרו tab: approved, mailed, and not in yet. It is
  // the only count on this screen that represents unfinished business nobody is
  // being reminded about.
  const stuckCount = requests.filter(r => r.status === 'approved' && r.stage !== 'done').length;
  const missingGroupCount = requests.filter(r => r.status === 'pending' && !effectiveGroup(r)).length;

  /** The approved rows, bucketed by how far they got, in stage order. Empty
   *  buckets are dropped — an empty "בוצע חיבור" card says nothing. */
  const approvedSections = useMemo(
    () => STAGES
      .map(s => ({ ...s, rows: approved.filter(r => r.stage === s.key) }))
      .filter(s => s.rows.length > 0),
    [approved],
  );

  /**
   * The pending list, split by דבוקה, with the ones that still need one first.
   *
   * ⚠️ This is the readability fix, and the reason it is sections and not sorting:
   * the backfill (migration 090) put the whole club in here at once, and 25 rows of
   * identical grey — each carrying a truncated address, a timestamp, a status chip
   * and three group buttons — was unreadable. Ofer's words: "מאוד קשה להבין מה
   * קורה". Grouping is what makes the screen answer a question ("nine in דבוקה 2,
   * four still unassigned") rather than present a wall.
   *
   * 'none' leads because it is the only actionable section: approval is blocked
   * without a group, so those rows are the ones holding up a bulk run.
   */
  const pendingSections = useMemo(() => {
    const byGroup = new Map<string, Registration[]>();
    for (const r of pending) {
      const key = effectiveGroup(r) || 'none';
      const list = byGroup.get(key);
      if (list) list.push(r); else byGroup.set(key, [r]);
    }
    const sections: Array<{
      key: string; label: string; band: number | null; hex: string | null;
      chip: { bg: string; text: string; border: string } | null; rows: Registration[];
    }> = [];
    const none = byGroup.get('none');
    if (none?.length) sections.push({ key: 'none', label: 'בלי דבוקה', band: null, hex: null, chip: null, rows: none });
    for (const g of groups) {
      const rows = byGroup.get(g.id);
      if (rows?.length) {
        const resolved = resolveGroup(g.name);
        sections.push({ key: g.id, label: `דבוקה ${g.band}`, band: g.band, hex: resolved.hex, chip: resolved.colors.chip, rows });
      }
    }
    // A group that is no longer in /api/groups — a stale id on an old row. Kept
    // visible rather than silently dropped from a list of people.
    for (const [key, rows] of byGroup) {
      if (key !== 'none' && !groups.some(g => g.id === key)) {
        sections.push({ key, label: 'דבוקה לא מזוהה', band: null, hex: null, chip: null, rows });
      }
    }
    return sections;
  }, [pending, groups, override]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const call = async (
    r: Registration,
    action: 'approve' | 'reject',
  ): Promise<{ emailed: boolean; emailReason?: string | null }> => {
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
    return { emailed: out.emailed !== false, emailReason: out.emailReason ?? null };
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
      const { emailed, emailReason } = await call(r, action);
      // emailed:false means the approval went through but Resend didn't — the
      // person is approved and does NOT know it. Worth saying out loud, with the
      // reason, because the fix is a human one: the אושרו tab now carries their
      // link, so it is "copy this and send it" rather than "something failed".
      if (action === 'approve' && !emailed) {
        setNote(`אושר — אבל המייל לא נשלח. ${mailFailureText(emailReason)} הקישור שלהם מחכה בטאב "אושרו" — אפשר להעתיק ולשלוח בוואטסאפ.`);
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

  // ── THE LINK, IN HUMAN HANDS ────────────────────────────────────────────────
  //
  // Approval's whole payload is one URL, and until now it existed only inside an
  // email nobody could confirm had arrived. On 2026-09-06 an approval sent no mail
  // and said nothing about it (Resend's SDK resolves with `{ error }` instead of
  // throwing, so the route's `emailed` was always true) — leaving a person
  // approved, waiting, and unreachable from every screen in the app.
  //
  // So the link is on the screen now, in the two forms that actually get used:
  // copied, and sent over WhatsApp, which is where this club talks anyway.
  const joinUrl = (r: Registration) =>
    r.inviteToken ? `${window.location.origin}/join/${r.inviteToken}` : null;

  const copyLink = async (r: Registration) => {
    const url = joinUrl(r);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(r.id);
      setTimeout(() => setCopiedId(prev => (prev === r.id ? null : prev)), 2000);
    } catch {
      // Clipboard access can be refused (an insecure context, or a denied
      // permission). Showing the URL is the fallback that always works.
      setError(url);
    }
  };

  const shareWhatsApp = (r: Registration) => {
    const url = joinUrl(r);
    if (!url) return;
    const text = `היי! אושרת למדרגות 🏃 נשאר רק להשלים את ההרשמה ולהתחבר עם Strava:\n${url}\nהקישור אישי — לא להעביר.`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };

  /** Send the approval mail again. Same address, same link — see the route. */
  const resend = async (r: Registration) => {
    setBusyId(r.id);
    setError(null);
    setNote(null);
    try {
      const res = await fetch('/api/admin/registrations/resend', {
        method: 'POST',
        headers: await apiHeaders(true),
        body: JSON.stringify({ id: r.id }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorText(out.error));
      if (out.emailed) setNote(`המייל נשלח מחדש ל-${r.email}.`);
      else setNote(`${mailFailureText(out.emailReason)} הקישור עצמו תקין — אפשר להעתיק אותו ולשלוח בוואטסאפ.`);
      await mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שליחה מחדש נכשלה');
    } finally {
      setBusyId(null);
    }
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
          {/* The subline answers the question the open tab is asking. On ממתינות
              that is "how many are waiting"; on אושרו it is the one nobody was being
              told — approved, mailed, and still not in the app. */}
          {tab === 'approved' ? (
            <p className="mt-0.5 text-xs">
              <span className="font-semibold text-ink-900">
                {stuckCount === 0 ? 'כולם השלימו את החיבור' : `${stuckCount} אושרו ועוד לא נכנסו`}
              </span>
              <span className="text-ink-400"> · {approvedCount} אושרו בסך הכל</span>
            </p>
          ) : (
            <p className="mt-0.5 text-xs">
              <span className="font-semibold text-ink-900">
                {pendingCount === 0 ? 'אין הרשמות שממתינות' : `${pendingCount} ממתינות לאישור`}
              </span>
              {missingGroupCount > 0 && <span className="text-ink-400"> · {missingGroupCount} ללא דבוקה</span>}
            </p>
          )}
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
          { value: 'approved' as const, label: `אושרו · ${approvedCount}`, icon: Check, activeBg: 'bg-ink-900' },
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
          placeholder="חיפוש לפי אימייל או שם"
          aria-label="חיפוש לפי אימייל או שם"
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

      {/* Pending tab only: the other two tabs have no selectable rows, so a
          "בחר הכל" over them selected nothing and said "0 מתוך 0". */}
      {tab === 'pending' && pending.length > 0 && (
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

      {/* THE PENDING TAB — one card per דבוקה. See pendingSections above for why. */}
      {tab === 'pending' && pending.length > 0 && (
        <div className="mt-4 space-y-4">
          {pendingSections.map(s => (
            <div key={s.key}>
              {/* The header is deliberately BIG — 13px bold ink, not the 3xs grey
                  uppercase caption used elsewhere on this screen. It is the thing
                  that has to be legible while scrolling past twenty-five rows, and
                  as a caption it was quieter than the rows it was labelling. */}
              <div className="flex items-center justify-between gap-2 px-2 mb-1.5">
                <span className="flex items-center gap-2 min-w-0">
                  {/* The colour, once, at the head of the section — the same band
                      hue the rest of the app uses for that דבוקה (resolveGroup, so
                      it cannot drift). */}
                  <span
                    className={cn('w-2.5 h-2.5 rounded-full shrink-0', !s.hex && 'bg-ink-300')}
                    style={s.hex ? { backgroundColor: s.hex } : undefined}
                    aria-hidden="true"
                  />
                  <span className="text-13 font-bold text-ink-900 truncate">{s.label}</span>
                  {/* The count in the band's own chip colours rather than grey text:
                      "nine in דבוקה 2" is the fact this screen exists to show, and
                      the -ink text tones are the ones picked for small bold type on
                      a tint (getGroupColors), so this stays readable. */}
                  <span
                    className={cn(
                      'text-3xs font-bold px-1.5 py-0.5 rounded-md border shrink-0',
                      s.chip ? [s.chip.bg, s.chip.text, s.chip.border] : 'bg-page text-ink-500 border-page',
                    )}
                  >
                    {s.rows.length}
                  </span>
                </span>
                {/* Said on the section that it applies to, instead of once at the
                    top of a list where the blocked rows were 20 rows further down. */}
                {!s.band && <span className="text-3xs font-semibold text-ink-900 shrink-0">האישור חסום</span>}
              </div>
              {/* A 3px stripe down the card's leading edge in the band colour, so
                  the colour survives past the header once the header has scrolled
                  off. Colour sections only: the "בלי דבוקה" card marks its rows
                  individually in black, and stacking both would read as 6px. */}
              <div
                className="rounded-card bg-card overflow-hidden shadow-[0_2px_12px_rgba(0,0,0,0.06)]"
                style={s.hex ? { borderInlineStartWidth: 3, borderInlineStartStyle: 'solid', borderInlineStartColor: s.hex } : undefined}
              >
                {s.rows.map((r, i) => (
                  <QueueRow
                    key={r.id}
                    r={r}
                    groups={groups}
                    last={i === s.rows.length - 1}
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
            </div>
          ))}
          <p className="px-2 text-3xs text-ink-400 leading-relaxed">
            אישור שולח מייל עם קישור להשלמת ההרשמה. עד שלוחצים על הקישור אף אחד לא נכנס לאפליקציה.
          </p>
        </div>
      )}

      {/* ── THE אושרו TAB ─────────────────────────────────────────────────────────
          One card per stage, in the order the stages happen, because "אישרתי אותם —
          איפה הם עומדים?" is a question with three different answers and three
          different follow-ups: chase the first, help the second, ignore the third.
          A single flat "approved" list answered none of them. */}
      {tab === 'approved' && approved.length > 0 && (
        <div className="mt-4 space-y-4">
          {approvedSections.map(s => (
            <div key={s.key}>
              <div className="px-2 mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-13 font-bold text-ink-900">{s.label}</span>
                  <span className="text-3xs font-bold px-1.5 py-0.5 rounded-md bg-page text-ink-500 shrink-0">
                    {s.rows.length}
                  </span>
                </div>
                {/* The hint is the section's whole justification — the label alone
                    ("בוצע חיבור") does not say that those people are stuck. */}
                <p className="mt-0.5 text-3xs text-ink-400 leading-relaxed">{s.hint}</p>
              </div>
              <div className="rounded-card bg-card overflow-hidden shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
                {s.rows.map((r, i) => (
                  <QueueRow
                    key={r.id}
                    r={r}
                    groups={groups}
                    last={i === s.rows.length - 1}
                    selected={false}
                    busy={busyId === r.id || !!bulk}
                    groupId={effectiveGroup(r)}
                    copied={copiedId === r.id}
                    onToggle={() => toggle(r.id)}
                    onPickGroup={(gid) => setOverride(prev => ({ ...prev, [r.id]: gid }))}
                    onApprove={() => act(r, 'approve')}
                    onReject={() => setConfirmReject(r)}
                    onCopy={() => copyLink(r)}
                    onShare={() => shareWhatsApp(r)}
                    onResend={() => resend(r)}
                  />
                ))}
              </div>
            </div>
          ))}
          <p className="px-2 text-3xs text-ink-400 leading-relaxed">
            Strava הוא הדלת היחידה לאפליקציה — מי שלא חיבר אותו לא נכנס, גם אם מילא את כל הפרטים.
          </p>
        </div>
      )}

      {tab === 'approved' && approved.length === 0 && requests.length > 0 && (
        <p className="mt-6 text-center text-sm text-ink-500">עוד לא אישרת אף אחד.</p>
      )}

      {/* THE "הכל" TAB — one flat card, because it is a history and not a worklist:
          it mixes statuses, so splitting it by דבוקה would group things that are not
          comparable. Newest first, for the same reason. */}
      {tab === 'all' && history.length > 0 && (
        <div className="mt-4">
          <SectionCaption>כל ההרשמות · {history.length}</SectionCaption>
          <div className="rounded-card bg-card overflow-hidden shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
            {history.map((r, i) => (
              <QueueRow
                key={r.id}
                r={r}
                groups={groups}
                last={i === history.length - 1}
                selected={selected.has(r.id)}
                busy={busyId === r.id || !!bulk}
                groupId={effectiveGroup(r)}
                copied={copiedId === r.id}
                onToggle={() => toggle(r.id)}
                onPickGroup={(gid) => setOverride(prev => ({ ...prev, [r.id]: gid }))}
                onApprove={() => act(r, 'approve')}
                onReject={() => setConfirmReject(r)}
                onCopy={() => copyLink(r)}
                onShare={() => shareWhatsApp(r)}
                onResend={() => resend(r)}
              />
            ))}
          </div>
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

/** The three approved stages, as a chip. Ordered light → solid, so the row reads
 *  as progress: grey = nothing happened, tinted = started, black = in. */
const STAGE_FACE: Record<Stage, { label: string; cls: string }> = {
  emailed: { label: 'מייל נשלח', cls: 'bg-page text-ink-500' },
  connected: { label: 'בוצע חיבור', cls: 'bg-ink-900/10 text-ink-900' },
  done: { label: 'סיימו חיבור', cls: 'bg-ink-900 text-white' },
};

/**
 * One request. Fixed height and a single line of identity, because thirty of
 * these have to be scannable: email + how long they've waited on top, the group
 * chips and the actions underneath.
 *
 * The name is on it when there is one — the public form never asks, so it only
 * exists after /join. Until then the email IS the person, which is why the
 * address never gives up its line.
 */
function QueueRow({
  r, groups, last, selected, busy, groupId, copied, onToggle, onPickGroup, onApprove, onReject,
  onCopy, onShare, onResend,
}: {
  r: Registration;
  groups: GroupOption[];
  last: boolean;
  selected: boolean;
  busy: boolean;
  groupId: string;
  copied?: boolean;
  onToggle: () => void;
  onPickGroup: (groupId: string) => void;
  onApprove: () => void;
  onReject: () => void;
  onCopy?: () => void;
  onShare?: () => void;
  onResend?: () => void;
}) {
  const isPending = r.status === 'pending';
  const stage = r.status === 'approved' ? (r.stage as Stage) : null;
  /** The invite-link controls, on the rows where they change an outcome: approved,
   *  has a token, and not in yet. On a 'done' row there is nobody to send it to. */
  const showLinkActions = !!(stage && stage !== 'done' && r.inviteToken && onCopy);
  const needsGroup = isPending && !groupId;
  /** The row's דבוקה, resolved to its number and its brand colours. null when the
   *  row has no group, or an id that /api/groups no longer knows. */
  const band = useMemo(() => {
    const g = groups.find(x => x.id === groupId);
    if (!g) return null;
    return { number: g.band, chip: resolveGroup(g.name).colors.chip };
  }, [groups, groupId]);

  /**
   * Whether this row is showing the picker for a group it ALREADY has.
   *
   * Requested directly ("אני רוצה שיהיה אופציה במסך של הpending לשנות דבוקה
   * לאתלט"). It reverses an earlier call of mine to show the picker only where a
   * group was missing — which did clean up the list, and also made the one number
   * that matters here unchangeable. Behind a tap rather than always-on, so the
   * twenty-five rows stay scannable and a mis-tap while scrolling cannot silently
   * re-band somebody: opening the picker is one deliberate tap, and the change is
   * still only local state until Approve commits it.
   *
   * ⚠️ For a backfilled row the athlete ALREADY has a group and approving
   * OVERWRITES it (see migration 090) — so this control is the real thing, not a
   * queue-only annotation.
   */
  const [editing, setEditing] = useState(false);
  const showPicker = isPending && (needsGroup || editing);

  return (
    <div
      className={cn(
        !last && 'border-b border-page',
        selected && 'bg-page/40',
        // A black edge on the row's leading side. Eight of these down the list is
        // the "these are the ones blocking you" signal, and it survives being
        // glanced at, which a greyed-out button alone does not.
        needsGroup && 'shadow-[inset_-3px_0_0_0_#1D1E26]',
      )}
    >
    <div
      className={cn(
        // Taller than the 62px it was: the address moved up to 14px and the badge
        // sits under it, and cramming both into 62 is what made the old row read as
        // a single grey smudge.
        'flex items-center gap-2.5 px-3.5 py-2.5 min-h-[70px]',
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
        {/* THE ADDRESS IS THE ROW. It is the only thing here that identifies a
            person, and it was the thing being squeezed: at 13px with a timestamp,
            a status chip and three buttons on the same line, every address was
            truncated mid-domain ("grosfeldofe…"), which is unreadable and, worse,
            ambiguous between two people. It now owns line one at 14px, with
            everything else demoted to line two. */}
        <span dir="ltr" title={r.email} className="block text-sm font-semibold text-ink-900 truncate text-left select-all">
          {r.email}
        </span>

        {/* dir=ltr on the SECOND line too, and it matters: the address above is an
            LTR block, so it sits hard against the left edge, while an RTL line
            underneath starts hard against the RIGHT. That split the row into two
            unrelated columns — the badge for a person was 250px away from their
            address. Both lines now begin at the same left edge, so a row reads as
            one thing. The Hebrew inside each chip still renders RTL by itself. */}
        {isPending ? (
          <div dir="ltr" className="mt-1 flex items-center gap-1.5">
            {/* The band badge Ofer asked for, in that דבוקה's own colour (via
                resolveGroup, so it matches the league table and the athletes list
                and cannot drift). On a row that HAS a group this replaces the three
                buttons entirely — which is most rows after the backfill, and the
                other half of why this list was so hard to read. */}
            {band && !editing && (
              <button
                onClick={() => setEditing(true)}
                disabled={busy}
                aria-label={`דבוקה ${band.number} — החלפת דבוקה`}
                className={cn(
                  'flex items-center gap-1 text-3xs font-bold px-2 py-0.5 rounded-md border shrink-0 whitespace-nowrap',
                  band.chip.bg, band.chip.text, band.chip.border,
                  'disabled:opacity-50',
                )}
              >
                דבוקה {band.number}
                {/* A tiny caret is the whole affordance. Anything more (a pencil, a
                    "שינוי" label) is 25 copies of a control nobody uses on most
                    rows, which is what made this list unreadable in the first place. */}
                <ChevronDown className="h-2.5 w-2.5 opacity-60" strokeWidth={3} aria-hidden="true" />
              </button>
            )}
            {showPicker && (
              <>
                {needsGroup && (
                  <span className="text-3xs font-bold text-ink-900 shrink-0 whitespace-nowrap">בחר דבוקה</span>
                )}
                {/* Three chips instead of a <select>: at this density a native
                    picker is two taps and a modal per person, and the whole point
                    is to get through thirty of them. The one currently set is
                    filled in its own band colour, so the row still answers "which
                    דבוקה is this?" while the picker is open. */}
                <span className="flex gap-1 shrink-0">
                  {groups.map(g => {
                    const on = g.id === groupId;
                    const chip = resolveGroup(g.name).colors.chip;
                    return (
                      <button
                        key={g.id}
                        onClick={() => { onPickGroup(g.id); setEditing(false); }}
                        disabled={busy}
                        aria-label={`דבוקה ${g.band}`}
                        aria-pressed={on}
                        className={cn(
                          'w-[26px] h-[26px] rounded-lg text-3xs font-bold flex items-center justify-center border',
                          on ? [chip.bg, chip.text, 'border-current'] : 'bg-page text-ink-500 border-transparent active:bg-ink-300/40',
                        )}
                      >
                        {g.band}
                      </button>
                    );
                  })}
                </span>
                {/* Only when a group already existed: closing an empty picker would
                    hide the one control the row needs. */}
                {editing && !needsGroup && (
                  <button
                    onClick={() => setEditing(false)}
                    aria-label="סגירה"
                    className="w-[26px] h-[26px] rounded-lg text-ink-400 flex items-center justify-center shrink-0 active:bg-page"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </>
            )}
            {!showPicker && (
              <>
                <span className="text-3xs text-ink-300 shrink-0" aria-hidden="true">·</span>
                <span className="text-3xs text-ink-400 shrink-0 truncate">{waitingFor(r.createdAt)}</span>
              </>
            )}
          </div>
        ) : (
          <div dir="ltr" className="mt-1 flex items-center gap-1.5">
            {/* Three faces, not two. 'member' is deliberately the quiet one — a
                flat grey chip rather than the black "אושר" or the red "נדחה":
                nobody did anything and nobody has to. It reads as a note in the
                margin, which is what it is. */}
            {/* An approved row says its STAGE, not "אושר". "אושר" was true and
                useless: it is the one thing the reader already knows, and it looked
                identical whether the mail bounced or the person finished an hour
                ago. 'member' stays deliberately the quiet one — a flat grey chip:
                nobody did anything and nobody has to. */}
            <span
              className={cn(
                'text-3xs font-bold px-1.5 py-0.5 rounded shrink-0',
                stage ? STAGE_FACE[stage].cls : '',
                r.status === 'rejected' && 'bg-accent-red/15 text-accent-red-ink',
                r.status === 'member' && 'bg-page text-ink-400',
              )}
            >
              {stage ? STAGE_FACE[stage].label : r.status === 'rejected' ? 'נדחה' : 'כבר חבר'}
            </span>
            <span className="text-3xs text-ink-400 truncate">
              {/* The name once they have typed one at /join. Only from 'connected'
                  on: before that the athlete row still carries
                  placeholderNameFromEmail(), so showing it would be the address
                  twice, dressed up as a name. */}
              {stage && stage !== 'emailed' && r.athleteName ? `${r.athleteName} · ` : ''}
              {r.status === 'member' ? 'נרשם מהקישור, יש לו כבר חשבון' : r.groupName || 'ללא דבוקה'}
              {r.status === 'rejected' && r.rejectedBy && ` · ${r.rejectedBy}`}
            </span>
          </div>
        )}
      </div>

      {isPending && (
        <div className="flex items-center gap-1 shrink-0">
          {/* ⚠️ BOTH OF THESE WERE UNDER 30px. "גם האישור שם לא ממש נוח" — and it
              was not a matter of taste: a 28×28 circle beside a 28px pill, on a
              70px row, is two adjacent sub-minimum targets where one of them is
              irreversible. Now 40px tall with a 44px touch box (the -my-2/py-2
              trick, so the target grows without the row growing), and the reject
              X is pushed to the edge with a gap between them. */}
          <button
            onClick={onReject}
            disabled={busy}
            className="w-10 h-10 -my-1 rounded-full text-ink-400 flex items-center justify-center disabled:opacity-40 active:bg-page"
            aria-label="דחייה"
          >
            <X className="h-4 w-4" />
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
              'h-10 min-w-[64px] px-4 rounded-pill text-13 font-semibold transition-colors',
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

    {/* ── THE LINK, WHERE A PERSON CAN REACH IT ────────────────────────────────
        Its own strip under the identity rather than three more icons on the right:
        at 44px each they do not fit beside an email address on a phone, and these
        are the actions that get taken when a mail did not arrive — which is the
        common case until RESEND_FROM_EMAIL is set on a verified domain. Copy first,
        because it is the one that always works; WhatsApp second, because that is
        where this club actually talks; re-send last, since it is the one that can
        fail again for the same reason. */}
    {showLinkActions && (
      <div className="flex items-center gap-2 px-3.5 pb-2.5 -mt-1">
        <button
          onClick={onCopy}
          disabled={busy}
          className={cn(
            'h-9 px-3 rounded-pill text-3xs font-semibold flex items-center gap-1.5 border transition-colors disabled:opacity-40',
            copied ? 'bg-ink-900 text-white border-ink-900' : 'bg-card text-ink-700 border-ink-900/20 active:bg-page',
          )}
        >
          {copied ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'הועתק' : 'העתקת קישור'}
        </button>
        <button
          onClick={onShare}
          disabled={busy}
          className="h-9 px-3 rounded-pill text-3xs font-semibold flex items-center gap-1.5 bg-card text-ink-700 border border-ink-900/20 active:bg-page disabled:opacity-40"
        >
          <MessageCircle className="h-3.5 w-3.5" />
          וואטסאפ
        </button>
        <button
          onClick={onResend}
          disabled={busy}
          className="h-9 px-3 rounded-pill text-3xs font-semibold flex items-center gap-1.5 text-ink-400 active:bg-page disabled:opacity-40"
        >
          <Send className="h-3.5 w-3.5" />
          שליחה מחדש
        </button>
      </div>
    )}
    </div>
  );
}
