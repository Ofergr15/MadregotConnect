import { createServerClient } from '@/lib/supabase/server';
import { notifyAcademyExistingForm, notifyAcademyMoveIn } from '@/lib/email';
import { inviteUrl } from './intake';
import type { VerifiedCaller } from '@/lib/auth/self-or-staff';

type Db = ReturnType<typeof createServerClient>;

/**
 * Did the invitation's email actually go out? (Ofer, 11-17: an invite counted as done even
 * when its mail failed, and the only retry was the 48h reminder.)
 *
 * Two mails per move-in card: the details form (before the form is filled) and the install
 * mail (after the manager accepts). The state is read from email_log — the card's latest
 * send of that mail — so it stays true after a reload, and the resend below is the same
 * mail, to the same person, with the same link.
 */

export type InviteMailKind = 'form' | 'install';

/** The templates that count as "this mail" (the 48h reminders included: a reminder that
 *  arrived means the link reached them). */
export const MAIL_TEMPLATES: Record<InviteMailKind, string[]> = {
  form: ['academy_existing_form', 'academy_existing_form_reminder'],
  install: ['academy_move_in', 'academy_install_reminder'],
};
const KIND_OF: Record<string, InviteMailKind> = Object.fromEntries(
  (Object.entries(MAIL_TEMPLATES) as Array<[InviteMailKind, string[]]>).flatMap(([k, ts]) => ts.map((t) => [t, k])),
);

/** Statuses that mean nothing reached the inbox. 'skipped' included: no key / no real address. */
export const FAILED_STATUSES = new Set(['refused', 'failed', 'bounced', 'complained', 'skipped']);
const OK_STATUSES = new Set(['sent', 'delivered', 'delayed']);

export interface MailState {
  kind: InviteMailKind;
  status: string;
  failed: boolean;
  error: string | null;
  at: string;
}

export const RESEND_GUARD_MS = 60_000;

type LogRow = { candidate_id: string | null; template: string; status: string; error_code: string | null; error_message: string | null; created_at: string };

/** The latest form mail and install mail per card. Empty (never an error) before 096/126. */
export async function loadMailStates(supabase: Db, cardIds: string[]): Promise<Map<string, Partial<Record<InviteMailKind, MailState>>>> {
  const out = new Map<string, Partial<Record<InviteMailKind, MailState>>>();
  if (!cardIds.length) return out;
  const { data, error } = await supabase.from('email_log')
    .select('candidate_id, template, status, error_code, error_message, created_at')
    .in('candidate_id', cardIds)
    .in('template', [...MAIL_TEMPLATES.form, ...MAIL_TEMPLATES.install])
    .order('created_at', { ascending: false })
    .limit(2000);
  if (error || !data) return out;
  for (const r of data as LogRow[]) {
    const kind = KIND_OF[r.template];
    if (!r.candidate_id || !kind) continue;
    const cur = out.get(r.candidate_id) ?? {};
    if (cur[kind]) continue; // newest first: the first one seen is the latest
    cur[kind] = {
      kind, status: r.status, failed: FAILED_STATUSES.has(r.status),
      error: r.error_message || r.error_code || null, at: r.created_at,
    };
    out.set(r.candidate_id, cur);
  }
  return out;
}

/** The mail that matters for the card now: the install mail once accepted, else the form's. */
export function currentMail(states: Partial<Record<InviteMailKind, MailState>> | undefined, accepted: boolean): MailState | null {
  if (!states) return null;
  return (accepted ? states.install : states.form) ?? null;
}

export interface ResendResult { status: number; body: Record<string, unknown> }

/**
 * "שליחה חוזרת": the SAME mail again (same template, same link — the card's invite_token for
 * the form, the athlete's invite_token for the install mail) to that one person. Creates no
 * account, mints no token, touches no other row. A send of the same mail for the same card
 * that went out in the last minute refuses (a double tap); one that went out earlier is
 * allowed, and logged.
 */
export async function resendInviteMail(supabase: Db, caller: VerifiedCaller, cardId: string, kind: InviteMailKind, now = Date.now()): Promise<ResendResult> {
  const { data: c } = await supabase.from('academy_candidates')
    .select('id, name, email, athlete_id, invite_token, accepted_at, archived_at').eq('id', cardId).maybeSingle();
  const card = c as { id: string; name: string | null; email: string | null; athlete_id: string | null; invite_token: string | null; accepted_at: string | null; archived_at: string | null } | null;
  if (!card || card.archived_at) return { status: 404, body: { error: 'not_found' } };

  type AthleteRow = { id: string; email: string | null; name: string | null; invite_token: string | null };
  let athlete: AthleteRow | null = null;
  if (card.athlete_id) {
    const { data: a } = await supabase.from('athletes').select('id, email, name, invite_token').eq('id', card.athlete_id).maybeSingle();
    athlete = (a as AthleteRow | null) ?? null;
  }
  const email = (card.email || athlete?.email || '').trim();
  if (!email) return { status: 400, body: { error: 'no_email' } };

  if (kind === 'form') {
    if (card.accepted_at) return { status: 409, body: { error: 'already_accepted' } };
    if (!card.invite_token) return { status: 409, body: { error: 'not_invited' } };
  } else {
    if (!card.accepted_at) return { status: 409, body: { error: 'not_accepted' } };
    if (!athlete?.invite_token) return { status: 409, body: { error: 'no_join_token' } };
  }

  // The double-tap guard, and the "it already went out" note.
  const { data: recent } = await supabase.from('email_log')
    .select('status, created_at').eq('candidate_id', card.id).in('template', MAIL_TEMPLATES[kind])
    .order('created_at', { ascending: false }).limit(5);
  const lastOk = ((recent || []) as Array<{ status: string; created_at: string }>).find((r) => OK_STATUSES.has(r.status));
  if (lastOk && now - Date.parse(lastOk.created_at) < RESEND_GUARD_MS) {
    return { status: 429, body: { error: 'just_sent', sentAt: lastOk.created_at } };
  }
  if (lastOk) console.info(`academy resend: ${kind} mail for card ${card.id} already went out at ${lastOk.created_at}; resent by ${caller.athleteId}`);

  const name = card.name || athlete?.name || null;
  const sent = await (kind === 'form'
    ? notifyAcademyExistingForm({ email, name, url: inviteUrl(card.invite_token!), candidateId: card.id, athleteId: card.athlete_id })
    : notifyAcademyMoveIn({ email, name, token: athlete!.invite_token!, athleteId: athlete!.id, candidateId: card.id })
  ).catch((err: unknown) => { console.error('academy resend: send threw:', err); return null; });

  const emailed = !!sent && sent.ok;
  const fail = sent && !sent.ok ? sent : null;
  return {
    status: 200,
    body: { cardId: card.id, kind, emailed, alreadySent: !!lastOk, ...(emailed ? {} : { error: fail?.reason || 'send_failed', code: fail?.code ?? null }) },
  };
}
