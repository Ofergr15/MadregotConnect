'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Check, ChevronLeft, Copy, DoorOpen, MessageCircle, RefreshCw, Search, Send, ShieldAlert, X } from 'lucide-react';
import { Card, ConfirmSheet, EmptyState, LoadingBlock, Sheet, Skeleton } from '@/components/ui';
import EmailHealthBanner from '@/components/EmailHealthBanner';
import { apiHeaders, useApi } from '@/lib/api';
import { cn, groupDisplayName, resolveGroup } from '@/lib/utils';
import { isSyntheticAuthEmail } from '@/lib/auth/athlete-identity';
import { teammateHref } from '@/lib/athletes/profile-link';
import { israelDateOf } from '@/lib/reports/last-7-days';
import {
  LOG_FILTERS, initialLogFilter, logCounts, logLoadErrorText, logState, matchesLogFilter, sortForLogFilter,
  type LogFilter, type LogState, type RegistrationStage,
} from '@/lib/admin/registrations-log';

/**
 * יומן ההרשמות — the /register submission log, and NOT a second approval queue.
 *
 * ── IT STOPPED BEING A DESTINATION ──────────────────────────────────────────
 * It used to be the other answer to "who is waiting for me to let them in", and
 * which of the two screens an approver got depended only on how they arrived:
 * browsing (Settings landing, Coach Tools, the athletes list) opened the entry
 * queue, while every ALERT — the admin email, both push notifications, the home
 * "pending registrations" card — opened this one. That is the report this fixed.
 *
 * So all of those now go to /dashboard/entry-queue, the duplicate-name warning
 * below has a counterpart on the entry-queue card (the approve button lives there
 * now, and a warning has to sit next to the button it is warning about), and this
 * screen is reached by one labelled link from the bottom of the entry queue, for
 * the three things it alone holds: the whole log including rejections, re-sending
 * a join link, and merging a Strava sign-in into the member it belongs to.
 *
 * ── THE PEOPLE SCREEN'S SHAPE (#82) ─────────────────────────────────────────
 * "יומן ההרשמות משתמש עדיין בעיצובים של פעם". It was the last admin list still
 * in the old grouped-card look, with a checkbox, three group chips and two
 * buttons on every row. Now it is the People screen: filter pills with counts,
 * one flat list with ONE state pill per row, and a tap opens the person's card,
 * which holds every action for that row and nothing for the others. The bulk
 * approve went with the checkboxes — the whole club is already in, and one
 * approve per person, from their card, is where the group gets decided anyway.
 *
 * Reject and merge are behind a confirm sheet — a mis-tap there is not
 * recoverable from this screen — but approve is not, because approving is the
 * expected outcome.
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
  /**
   * True when this row is a Strava sign-in the app could NOT place on the roster
   * by itself — i.e. its athlete row is keyed on a synthetic address.
   *
   * Approving one of these creates a SECOND row for a member who may already be in
   * the club: no group, no history, role 'runner'. It has happened six times. This
   * is a separate field from `matchCandidates` on purpose, because the case that
   * needs saying out loud is the one where the list is EMPTY: an unplaced sign-in
   * with nothing resembling it looks exactly like an ordinary stranger, and the
   * screen has to say which it is rather than going quiet.
   */
  unplaced: boolean;
  /**
   * "Isn't this somebody we already have?" — the roster rows this sign-in resembles,
   * likeliest first, at most three.
   *
   * DISPLAY ONLY, and the server means it: these are ranked without the
   * four-consonant floor the automatic matchers apply, so a short name like "Roy
   * Roth" appears here even though nothing in the app would ever merge on it. That
   * name is exactly why this is a list: the old single-suggestion field was null for
   * him, the queue showed nothing at all, and he was approved into a duplicate 35
   * seconds later. `confidence` says how much each one is worth — 'exact' (same
   * consonant skeleton), 'near' (one edit away) or 'weak' (a shared surname).
   */
  matchCandidates: Array<{ id: string; name: string | null; confidence: 'exact' | 'near' | 'weak' }>;
}

type MatchCandidate = Registration['matchCandidates'][number];

/**
 * How sure the server is, as a word rather than a score. An approver cannot act on
 * "0.82"; they can act on the difference between "probably him" and "the surname
 * matches, go and look".
 */
const CONFIDENCE_LABEL: Record<MatchCandidate['confidence'], string> = {
  exact: 'כנראה',
  near: 'אולי',
  weak: 'שם דומה',
};

/**
 * The sentence added to the confirm sheet, because the merge is one press and is
 * not undoable from any screen. A weak match gets the strongest warning: it is a
 * lead the queue produced so that nobody is shown a blank, NOT a finding.
 */
const CONFIDENCE_WARNING: Record<MatchCandidate['confidence'], string> = {
  exact: '',
  near: ' השם דומה אבל לא זהה — כדאי לוודא שזה אותו אדם.',
  weak: ' רק חלק מהשם דומה — חובה לוודא שזה אותו אדם לפני החיבור.',
};

/** The three states an approved person passes through. */
type Stage = RegistrationStage;

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
 * `reason` is Resend's own message, carried out by sendEmail() in lib/email/send.ts.
 * The one worth naming explicitly is the sandbox sender: with no RESEND_FROM_EMAIL set,
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

/** The pill on a row and on the card, in the People screen's colours: red is
 *  "you have to act", amber "stuck on the way in", green "in", grey "a record". */
const PILL: Record<LogState, { label: string; cls: string }> = {
  pending: { label: 'ממתין לאישור', cls: 'bg-accent-red/20 text-accent-red-ink' },
  emailed: { label: 'מייל נשלח', cls: 'bg-band-3/15 text-band-3-ink' },
  connected: { label: 'התחיל', cls: 'bg-band-3/15 text-band-3-ink' },
  done: { label: 'בפנים', cls: 'bg-accent-600/15 text-accent-900' },
  rejected: { label: 'נדחה', cls: 'bg-page text-ink-500' },
  member: { label: 'כבר חבר', cls: 'bg-page text-ink-500' },
};

const FILTER_LABEL: Record<LogFilter, string> = {
  pending: 'ממתינים',
  stuck: 'אושרו ולא נכנסו',
  in: 'בפנים',
  all: 'הכל',
};

/**
 * Who the row is. A Strava sign-in queues under an address the app invented, so its
 * Strava display name is the only real identity it has. Anybody else is their
 * address until they have typed a name at /join — before that the athlete row
 * carries a placeholder derived from the address, which would be it twice.
 */
function identity(r: Registration): { text: string; isName: boolean } {
  if (isSyntheticAuthEmail(r.email)) return { text: r.athleteName || 'התחברות דרך Strava', isName: true };
  if ((r.stage === 'connected' || r.stage === 'done') && r.athleteName) return { text: r.athleteName, isName: true };
  return { text: r.email, isName: false };
}

function initials(r: Registration): string {
  const id = identity(r);
  if (!id.isName) return (r.email[0] ?? '?').toUpperCase();
  return id.text.trim().split(/\s+/).slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase() || '?';
}

/** dd.MM.yy on the Israel calendar. */
function shortDate(iso: string): string {
  const [y, m, d] = israelDateOf(iso).split('-');
  return `${d}.${m}.${y.slice(2)}`;
}

export default function RegistrationsQueue() {
  /** null until the reader picks one: the log opens on the first filter with anybody
   *  in it (initialLogFilter), which is only knowable once the list has loaded. */
  const [filter, setFilter] = useState<LogFilter | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [confirmReject, setConfirmReject] = useState<Registration | null>(null);
  /** The row about to be folded into an existing member, AND which member — the
   *  log offers several, so the chosen one has to travel with it rather than being
   *  re-derived. Confirmed, because it moves an account rather than creating one. */
  const [confirmLink, setConfirmLink] = useState<{ request: Registration; candidate: MatchCandidate } | null>(null);
  /** The row whose link was just copied, for a two-second "הועתק". */
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Group choices the approver has made but not yet committed, keyed by request
  // id. Applied by Approve, so changing the group and approving is one action
  // rather than two round trips.
  const [override, setOverride] = useState<Record<string, string>>({});

  // Server-verified: the same /api/auth/me the rest of the admin UI reads, and the
  // same session flag (auth.user.canApprove) the routes below enforce since #82.
  const { data: meData, isLoading: meLoading } = useApi<{ canApprove?: boolean }>('/api/auth/me');
  const allowed = !!meData?.canApprove;

  const { data, error: loadError, isLoading, mutate } = useApi<{
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

  const requests = useMemo(() => data?.requests || [], [data]);
  const counts = useMemo(() => logCounts(requests), [requests]);
  const active = filter ?? initialLogFilter(requests);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = (r: Registration) =>
      !q || r.email.toLowerCase().includes(q) || (r.athleteName || '').toLowerCase().includes(q);
    return sortForLogFilter(requests.filter(r => matchesLogFilter(r, active) && hit(r)), active);
  }, [requests, active, query]);

  const open = requests.find(r => r.id === openId) ?? null;

  /** The group that WOULD be sent for this row: the approver's pick if they made
   *  one, otherwise what the applicant submitted. '' means none, which is the
   *  state the approve route rejects. */
  const effectiveGroup = (r: Registration) => (r.id in override ? override[r.id] : r.groupId || '');

  /** One approve/reject round trip. */
  const call = async (
    r: Registration,
    action: 'approve' | 'reject',
  ): Promise<{ emailed: boolean; emailReason?: string | null; activated?: boolean }> => {
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
    return { emailed: out.emailed !== false, emailReason: out.emailReason ?? null, activated: out.activated === true };
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
      const { emailed, emailReason, activated } = await call(r, action);
      // activated:true — they signed in with Strava and were waiting on the blocked
      // screen, so this approval put them straight in and pushed them a notification.
      // There is no link to chase and nothing failed.
      if (action === 'approve' && activated) {
        setNote(`${r.athleteName || r.email} בפנים — נשלחה התראה לאפליקציה. אין צורך בקישור.`);
      } else if (action === 'approve' && !emailed) {
        // The approval went through but Resend didn't — the person is approved and
        // does NOT know it. Said out loud with the reason, because the fix is a
        // human one: their card now carries the link to copy and send.
        setNote(`אושר — אבל המייל לא נשלח. ${mailFailureText(emailReason)} הקישור שלהם בכרטיס — אפשר להעתיק ולשלוח בוואטסאפ.`);
      }
      await mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'הפעולה נכשלה');
    } finally {
      setBusyId(null);
    }
  };

  // ── THE LINK, IN HUMAN HANDS ────────────────────────────────────────────────
  //
  // Approval's whole payload is one URL, and on 2026-09-06 an approval sent no
  // mail and said nothing about it — leaving a person approved, waiting, and
  // unreachable from every screen in the app. So the link is on the card, in the
  // two forms that actually get used: copied, and sent over WhatsApp.
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

  // ── "זה מישהו שכבר יש לנו" ───────────────────────────────────────────────────
  //
  // The other answer to a pending Strava sign-in: it belongs to a member who is
  // already here, and the two rows fold into one — their group, their history and
  // their role come back. Behind a confirmation, unlike approve: linking the wrong
  // row moves one person's account onto another's.
  const linkToMember = async (r: Registration, candidate: MatchCandidate) => {
    setBusyId(r.id);
    setError(null);
    setNote(null);
    try {
      const res = await fetch('/api/admin/registrations/link', {
        method: 'POST',
        headers: await apiHeaders(true),
        body: JSON.stringify({ id: r.id, athleteId: candidate.id }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorText(out.error));
      setNote(`חובר ל-${out.athleteName || candidate.name} — ההיסטוריה, הדבוקה והתפקיד שלו חזרו אליו.`);
      await mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'החיבור נכשל');
    } finally {
      setBusyId(null);
    }
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

  /** The list could not be fetched at all. See logLoadErrorText for why this is
   *  its own state and not the empty one. */
  const failed = !!loadError && !data?.requests;
  const failure = failed ? logLoadErrorText((loadError as { status?: number }).status) : null;

  /** Said where the reader is looking: on the card when one is open, since the
   *  sheet covers the page. */
  const messages = (
    <>
      {error && <p className="text-sm text-accent-red leading-relaxed" dir="auto">{error}</p>}
      {/* Kept loud: this is the one outcome where the screen says "done" and a
          person is left stranded. */}
      {note && <p className="text-sm font-semibold text-accent-red leading-relaxed">{note}</p>}
    </>
  );

  return (
    <div dir="rtl" className="space-y-3 pb-6">
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

      {/* The merge, spelled out before it happens. It is one press and it is not
          undoable from any screen, so the sheet names the person it is about to
          become and says what moves — and, when the match was only a plausible
          transliteration, says that too instead of presenting a guess as a fact. */}
      <ConfirmSheet
        open={!!confirmLink}
        onOpenChange={(o) => { if (!o) setConfirmLink(null); }}
        title="זה חבר שכבר יש לנו?"
        description={
          confirmLink
            ? `${confirmLink.request.athleteName || 'ההתחברות הזאת'} יחובר לחשבון של ${confirmLink.candidate.name} — האימונים, הדבוקה והתפקיד שלו יחזרו אליו, והרשומה הכפולה תימחק.${CONFIDENCE_WARNING[confirmLink.candidate.confidence]}`
            : undefined
        }
        confirmLabel="חיבור"
        cancelLabel="ביטול"
        onConfirm={() => {
          const target = confirmLink;
          setConfirmLink(null);
          if (target) void linkToMember(target.request, target.candidate);
        }}
      />

      <div className="flex items-center justify-between gap-3">
        {/* "יומן ההרשמות", not "בקשות הרשמה": this is the log, and the queue of
            people waiting is the entry queue, linked right below. */}
        <h1 className="text-[28px] font-black text-ink-700">יומן ההרשמות</h1>
        <button
          onClick={() => mutate()}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full text-ink-400 active:bg-page/60"
          aria-label="רענון"
        >
          <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
        </button>
      </div>

      {/* Where the decision is usually made. Anybody who arrives here from an old
          bookmark or a mail from before the merge is told in one line. */}
      <Link
        href="/dashboard/entry-queue?at=mine"
        className="flex min-h-[44px] items-center gap-1.5 text-xs font-semibold text-brand-600"
      >
        <DoorOpen className="h-3.5 w-3.5 shrink-0" />
        <span>לאישור ולמעקב — מחכים להיכנס</span>
      </Link>

      {/* Whether mail works at all decides what approving even means here, and it
          renders nothing when mail is healthy. */}
      <EmailHealthBanner />

      {failure ? (
        <div className="rounded-card border-2 border-accent-red/35 bg-card p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="h-5 w-5 shrink-0 text-accent-red mt-0.5" />
            <div className="min-w-0">
              <p className="text-[15px] font-bold text-accent-red">{failure.title}</p>
              <p className="mt-0.5 text-xs text-ink-500 leading-relaxed">{failure.hint}</p>
            </div>
          </div>
          <button
            onClick={() => mutate()}
            className="mt-3 w-full min-h-[44px] rounded-full bg-page text-sm font-semibold text-ink-700 active:bg-ink-300/40"
          >
            נסה שוב
          </button>
        </div>
      ) : (
        <>
          <label className="relative block">
            <Search className="absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-ink-400 pointer-events-none" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="חיפוש לפי שם או אימייל"
              aria-label="חיפוש לפי שם או אימייל"
              className="w-full bg-card border border-page rounded-full ps-9 pe-10 py-2.5 min-h-[44px] text-[15px] focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute top-1/2 -translate-y-1/2 end-1 grid h-10 w-10 place-items-center text-ink-400"
                aria-label="ניקוי החיפוש"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </label>

          <div className="flex flex-wrap gap-2">
            {LOG_FILTERS.map(f => {
              const on = active === f;
              return (
                <button
                  key={f}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setFilter(f)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-3 min-h-[44px] text-xs font-semibold transition-colors',
                    on ? 'bg-ink-700 border-ink-700 text-white' : 'bg-card border-page text-ink-500',
                  )}
                >
                  {FILTER_LABEL[f]}
                  {data && <span className={cn('tabular-nums', on ? 'text-white/70' : 'text-ink-400')}>{counts[f]}</span>}
                </button>
              );
            })}
          </div>

          {/* Migrations here are applied by hand, so "the table isn't there yet" is
              a real state, and not one to decode from an empty list. */}
          {data?.migrated === false && (
            <Card className="p-4">
              <p className="text-sm text-ink-900 font-semibold">הטבלה עוד לא נוצרה</p>
              <p className="text-ink-400 text-xs mt-1 leading-relaxed">
                צריך להריץ את <code dir="ltr">supabase/migrations/083_signup_requests.sql</code> ב-Supabase SQL editor.
              </p>
            </Card>
          )}

          {!open && messages}

          {isLoading && !data ? (
            <div className="space-y-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-16 rounded-card" />)}</div>
          ) : shown.length === 0 ? (
            <EmptyState
              title={query ? 'אין תוצאות לחיפוש' : active === 'pending' ? 'אין הרשמות שממתינות' : active === 'stuck' ? 'כל מי שאושר כבר בפנים' : 'אין כאן כלום כרגע'}
            />
          ) : (
            <ul className="overflow-hidden rounded-card bg-card divide-y divide-page">
              {shown.map(r => {
                const state = logState(r);
                const id = identity(r);
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => { setError(null); setNote(null); setOpenId(r.id); }}
                      className="flex w-full items-center gap-3 px-4 py-3 min-h-[60px] text-start active:bg-page/60"
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-extrabold text-white">
                        {initials(r)}
                      </span>
                      <span className="min-w-0 flex-1">
                        {/* An address is LTR and a Strava name is usually Hebrew, so
                            the line takes its direction from what it holds. */}
                        <span dir={id.isName ? 'auto' : 'ltr'} className="block truncate text-[15px] font-bold text-ink-700 text-start">
                          {id.text}
                        </span>
                        <span className="block truncate text-xs text-ink-400">
                          {[
                            r.status === 'member' ? 'יש לו כבר חשבון' : r.groupName ? groupDisplayName(r.groupName) : 'ללא דבוקה',
                            waitingFor(r.createdAt),
                          ].join(' · ')}
                        </span>
                      </span>
                      <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-2xs font-bold', PILL[state].cls)}>
                        {PILL[state].label}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      <Sheet open={!!open} onOpenChange={(o) => { if (!o) setOpenId(null); }}>
        {open && (
          <RegistrationCard
            r={open}
            groups={groups}
            groupId={effectiveGroup(open)}
            busy={busyId === open.id}
            copied={copiedId === open.id}
            messages={messages}
            onPickGroup={(gid) => setOverride(prev => ({ ...prev, [open.id]: gid }))}
            onApprove={() => act(open, 'approve')}
            onReject={() => { setOpenId(null); setConfirmReject(open); }}
            onLink={(candidate) => { setOpenId(null); setConfirmLink({ request: open, candidate }); }}
            onCopy={() => copyLink(open)}
            onShare={() => shareWhatsApp(open)}
            onResend={() => resend(open)}
          />
        )}
      </Sheet>
    </div>
  );
}

function KV({ label, value, ltr }: { label: string; value: React.ReactNode; ltr?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 text-sm">
      <span className="shrink-0 text-ink-500">{label}</span>
      <span dir={ltr ? 'ltr' : undefined} className="min-w-0 truncate text-end font-semibold text-ink-700">{value}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 px-1 text-2xs font-bold uppercase tracking-wider text-ink-400">{children}</p>;
}

/** One tappable line in an actions card, the People card's ActionRow as a button. */
function ActionButton({
  icon: Icon, label, onClick, disabled, tone = 'ink',
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'ink' | 'red';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full min-h-[48px] items-center gap-3 py-2 text-start text-[15px] font-semibold disabled:opacity-40',
        tone === 'red' ? 'text-accent-red' : 'text-ink-700',
      )}
    >
      <Icon className={cn('h-4 w-4 shrink-0', tone === 'red' ? 'text-accent-red' : 'text-ink-400')} />
      {label}
    </button>
  );
}

/**
 * One registration, opened. The alert on top is the row's pill spelled out with
 * what to do about it; the actions are only the ones that change an outcome for
 * this row — approve/reject/merge while it waits, the link while an approved
 * person is not in yet, the profile once they are.
 */
function RegistrationCard({
  r, groups, groupId, busy, copied, messages, onPickGroup, onApprove, onReject, onLink, onCopy, onShare, onResend,
}: {
  r: Registration;
  groups: GroupOption[];
  groupId: string;
  busy: boolean;
  copied: boolean;
  messages: React.ReactNode;
  onPickGroup: (groupId: string) => void;
  onApprove: () => void;
  onReject: () => void;
  onLink: (candidate: MatchCandidate) => void;
  onCopy: () => void;
  onShare: () => void;
  onResend: () => void;
}) {
  const state = logState(r);
  const id = identity(r);
  const isPending = state === 'pending';
  const needsGroup = isPending && !groupId;
  const showLinkActions = (state === 'emailed' || state === 'connected') && !!r.inviteToken;
  const profile = state === 'done' ? teammateHref(r.athleteId) : null;

  const alert: { title: string; hint: string; tone: 'red' | 'amber' } | null =
    isPending && r.unplaced ? {
      title: r.matchCandidates.length > 0
        ? (r.matchCandidates.length > 1 ? 'אחד מאלה כבר בקבוצה?' : 'זה מישהו שכבר בקבוצה?')
        : 'התחברות דרך Strava בלי שם דומה בקבוצה',
      hint: r.matchCandidates.length > 0
        ? 'אישור ייצור חבר חדש וכפול. אם זה אותו אדם, חברו אותו לחשבון הקיים.'
        : 'אישור ייצור חבר חדש.',
      tone: 'red',
    }
    : isPending ? { title: 'ממתין לאישור', hint: 'אישור שולח מייל עם קישור להשלמת ההרשמה.', tone: 'red' }
    : state === 'emailed' ? { title: 'אושר ועוד לא נגע בקישור', hint: 'אם המייל לא הגיע, העתיקו את הקישור ושלחו בוואטסאפ.', tone: 'amber' }
    : state === 'connected' ? { title: 'התחיל ולא סיים', hint: 'חסר לו Strava, ובלעדיו אין כניסה לאפליקציה.', tone: 'amber' }
    : null;

  return (
    <div dir="rtl" className="space-y-4 pb-4">
      <div className="flex items-center gap-3">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-brand-600 text-lg font-extrabold text-white">
          {initials(r)}
        </span>
        <div className="min-w-0">
          <p dir={id.isName ? 'auto' : 'ltr'} className="truncate text-xl font-black text-ink-700 text-start">{id.text}</p>
          <p className="text-xs text-ink-400">נרשם {shortDate(r.createdAt)} · {waitingFor(r.createdAt)}</p>
        </div>
      </div>

      {alert && (
        <div className={cn('rounded-card border-2 bg-card p-3.5', alert.tone === 'red' ? 'border-accent-red/35' : 'border-band-3/40')}>
          <p className={cn('text-[15px] font-bold', alert.tone === 'red' ? 'text-accent-red' : 'text-band-3-ink')}>{alert.title}</p>
          <p className="mt-0.5 text-xs text-ink-500">{alert.hint}</p>
          {/* One button PER candidate, each naming the person it would merge into:
              the name is the entire decision, so it is never behind a picker. */}
          {isPending && r.unplaced && r.matchCandidates.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {r.matchCandidates.map(c => (
                <button
                  key={c.id}
                  onClick={() => onLink(c)}
                  disabled={busy}
                  className={cn(
                    'min-h-[44px] max-w-full px-3 rounded-full text-xs font-semibold flex items-center gap-1.5 border active:bg-page disabled:opacity-40',
                    c.confidence === 'weak' ? 'bg-card text-ink-500 border-page' : 'bg-card text-ink-900 border-ink-900/25',
                  )}
                >
                  <span className="text-ink-400 shrink-0">{CONFIDENCE_LABEL[c.confidence]}</span>
                  <b className="font-bold truncate">{c.name}</b>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {messages}

      <section>
        <SectionTitle>פרטים</SectionTitle>
        <div className="rounded-card bg-card px-4 divide-y divide-page">
          <KV label="מצב" value={PILL[state].label} />
          {!isSyntheticAuthEmail(r.email) && <KV label="אימייל" value={r.email} ltr />}
          {r.status !== 'member' && <KV label="דבוקה" value={r.groupName ? groupDisplayName(r.groupName) : 'ללא דבוקה'} />}
          {r.approvedAt && <KV label="אושר" value={`${shortDate(r.approvedAt)}${r.approvedBy ? ` · ${r.approvedBy}` : ''}`} />}
          {r.rejectedAt && <KV label="נדחה" value={`${shortDate(r.rejectedAt)}${r.rejectedBy ? ` · ${r.rejectedBy}` : ''}`} />}
          {r.status === 'approved' && (
            <KV label="חיבורים" value={[r.hasStrava && 'Strava', r.hasGarmin && 'Garmin'].filter(Boolean).join(' · ') || 'אין עדיין'} />
          )}
        </div>
      </section>

      {/* The group is decided here, before the approve that commits it. For a
          backfilled row approving OVERWRITES the member's current group (migration
          090), so the chip that is on is the one that will be written. */}
      {isPending && (
        <section>
          <SectionTitle>{needsGroup ? 'צריך לבחור דבוקה לפני אישור' : 'דבוקה'}</SectionTitle>
          <div className="flex gap-2">
            {groups.map(g => {
              const on = g.id === groupId;
              const chip = resolveGroup(g.name).colors.chip;
              return (
                <button
                  key={g.id}
                  onClick={() => onPickGroup(g.id)}
                  disabled={busy}
                  aria-pressed={on}
                  className={cn(
                    'flex-1 min-h-[44px] rounded-full border text-sm font-bold',
                    on ? [chip.bg, chip.text, 'border-current'] : 'bg-card text-ink-500 border-page active:bg-page',
                  )}
                >
                  דבוקה {g.band}
                </button>
              );
            })}
          </div>
          <button
            onClick={onApprove}
            disabled={busy || needsGroup}
            className={cn(
              'mt-3 w-full min-h-[48px] rounded-full text-[15px] font-bold transition-colors',
              busy || needsGroup ? 'bg-page text-ink-400' : 'bg-ink-700 text-white active:bg-ink-900',
            )}
          >
            {busy ? 'מאשר…' : 'אישור ושליחת קישור במייל'}
          </button>
        </section>
      )}

      {(isPending || showLinkActions || profile) && (
        <section>
          <SectionTitle>פעולות</SectionTitle>
          <div className="rounded-card bg-card px-4 divide-y divide-page">
            {/* Copy first, because it is the one that always works; WhatsApp second,
                because that is where the club talks; re-send last, since it can fail
                again for the same reason. */}
            {showLinkActions && (
              <>
                <ActionButton icon={copied ? Check : Copy} label={copied ? 'הועתק' : 'העתקת הקישור האישי'} onClick={onCopy} disabled={busy} />
                <ActionButton icon={MessageCircle} label="שליחת הקישור בוואטסאפ" onClick={onShare} disabled={busy} />
                <ActionButton icon={Send} label="שליחת המייל מחדש" onClick={onResend} disabled={busy} />
              </>
            )}
            {profile && (
              <Link href={profile} className="flex min-h-[48px] items-center justify-between py-2 text-[15px] font-semibold text-ink-700">
                פרופיל
                <ChevronLeft className="h-4 w-4 text-ink-400" />
              </Link>
            )}
            {isPending && <ActionButton icon={X} label="דחיית ההרשמה" onClick={onReject} disabled={busy} tone="red" />}
          </div>
        </section>
      )}
    </div>
  );
}
