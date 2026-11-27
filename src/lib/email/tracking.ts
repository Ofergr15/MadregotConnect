/**
 * b25 delivery tracking — pure. Turns Resend webhook payloads into email_events rows,
 * and email_log + email_events into the email center's per-send totals and
 * per-recipient status. The DB reads live in the route.
 *
 * ⚠️ OPENS ARE APPROXIMATE. "opened" is a pixel load: Apple Mail Privacy Protection
 * pre-fetches it for every Apple Mail user (false opens), and image-blocking clients never
 * load it (false not-opened). A click is real. The screen says so beside every open rate,
 * and the "who hasn't opened" resend is a nudge, not proof somebody missed it.
 */

export type EmailEventType = 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complained' | 'delayed';

export const EVENT_BY_WEBHOOK: Record<string, EmailEventType> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.opened': 'opened',
  'email.clicked': 'clicked',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.delivery_delayed': 'delayed',
};

export interface WebhookPayload {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[] | string;
    created_at?: string;
    click?: { link?: string };
    bounce?: { type?: string; subType?: string; message?: string };
  };
}

export interface EventRow {
  type: EmailEventType;
  provider_id: string;
  svix_id: string | null;
  recipient: string | null;
  occurred_at: string;
  detail: string | null;
}

/**
 * The clicked link as stored. Domain-wide click tracking rewrites EVERY link, including the
 * transactional ones that carry a secret (login/phone-link/claim URLs with a token in the
 * query or fragment). Storing the full URL would park live sign-in links in a staff-readable
 * table, so only origin + path are kept — enough to tell which link was clicked.
 */
export function clickedLinkForLog(link?: string | null): string | null {
  if (!link) return null;
  try {
    const u = new URL(link);
    return `${u.origin}${u.pathname}`.slice(0, 500);
  } catch {
    return link.split(/[?#]/)[0].slice(0, 500) || null;
  }
}

/** The email_events row for one webhook, or null for an event we don't record. */
export function eventRowFrom(payload: WebhookPayload, svixId: string | null, now = new Date()): EventRow | null {
  const type = EVENT_BY_WEBHOOK[payload.type || ''];
  const providerId = payload.data?.email_id;
  if (!type || !providerId) return null;
  const to = payload.data?.to;
  const recipient = (Array.isArray(to) ? to[0] : to) || null;
  const when = payload.created_at || payload.data?.created_at;
  const occurred = when && !Number.isNaN(Date.parse(when)) ? new Date(when).toISOString() : now.toISOString();
  let detail: string | null = null;
  if (type === 'clicked') detail = clickedLinkForLog(payload.data?.click?.link);
  if (type === 'bounced') {
    const b = payload.data?.bounce;
    detail = [b?.type, b?.subType, b?.message].filter(Boolean).join(' · ').slice(0, 500) || null;
  }
  return { type, provider_id: providerId, svix_id: svixId, recipient: recipient ? recipient.toLowerCase() : null, occurred_at: occurred, detail };
}

/** One recipient's state, the strongest thing we know. A bounce or complaint beats an
 *  open (it is the actionable fact), a click beats an open, an open beats delivered. */
export type RecipientState = 'failed' | 'bounced' | 'complained' | 'clicked' | 'opened' | 'delivered' | 'sent' | 'skipped';

const RANK: Record<RecipientState, number> = {
  skipped: 0, sent: 1, delivered: 2, opened: 3, clicked: 4, complained: 5, bounced: 6, failed: 7,
};

export interface LogRow {
  id: string;
  created_at: string;
  recipients: string[];
  status: string;
  provider_id: string | null;
  athlete_id: string | null;
  error_code?: string | null;
}

export interface RecipientStatus {
  logId: string;
  email: string;
  athleteId: string | null;
  state: RecipientState;
  sentAt: string;
  deliveredAt: string | null;
  openedAt: string | null;
  clickedAt: string | null;
  opens: number;
  clicks: number;
  error: string | null;
}

export interface CampaignTotals {
  recipients: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  complained: number;
  failed: number;
  /** opened / delivered, 0..100 — APPROXIMATE (see the file header). */
  openRate: number | null;
  clickRate: number | null;
}

function baseState(status: string): RecipientState {
  if (status === 'refused' || status === 'failed') return 'failed';
  if (status === 'skipped') return 'skipped';
  if (status === 'bounced' || status === 'complained' || status === 'delivered') return status;
  return 'sent';
}

export function recipientStatuses(logs: LogRow[], events: Array<Pick<EventRow, 'type' | 'provider_id' | 'occurred_at'>>): RecipientStatus[] {
  const byProvider = new Map<string, typeof events>();
  for (const e of events) {
    const list = byProvider.get(e.provider_id) || [];
    list.push(e);
    byProvider.set(e.provider_id, list);
  }
  return logs.map(l => {
    const evs = (l.provider_id ? byProvider.get(l.provider_id) : null) || [];
    let state = baseState(l.status);
    const first = (t: EmailEventType) => evs.filter(e => e.type === t).map(e => e.occurred_at).sort()[0] ?? null;
    for (const e of evs) {
      const s: RecipientState = e.type === 'delayed' || e.type === 'sent' ? 'sent' : e.type;
      if (RANK[s] > RANK[state]) state = s;
    }
    return {
      logId: l.id,
      email: (l.recipients[0] || '').toLowerCase(),
      athleteId: l.athlete_id,
      state,
      sentAt: l.created_at,
      deliveredAt: first('delivered'),
      openedAt: first('opened'),
      clickedAt: first('clicked'),
      opens: evs.filter(e => e.type === 'opened').length,
      clicks: evs.filter(e => e.type === 'clicked').length,
      error: l.error_code ?? null,
    };
  });
}

/** A click implies an open even when the pixel never loaded (images off). */
const OPENED: RecipientState[] = ['opened', 'clicked'];

export function campaignTotals(rows: RecipientStatus[]): CampaignTotals {
  const n = (f: (r: RecipientStatus) => boolean) => rows.filter(f).length;
  const delivered = n(r => r.deliveredAt != null || ['delivered', 'opened', 'clicked', 'complained'].includes(r.state));
  const opened = n(r => OPENED.includes(r.state) || r.openedAt != null);
  const clicked = n(r => r.state === 'clicked' || r.clickedAt != null);
  return {
    recipients: rows.length,
    sent: n(r => r.state !== 'failed' && r.state !== 'skipped'),
    delivered,
    opened,
    clicked,
    bounced: n(r => r.state === 'bounced'),
    complained: n(r => r.state === 'complained'),
    failed: n(r => r.state === 'failed'),
    openRate: delivered ? Math.round((opened / delivered) * 100) : null,
    clickRate: delivered ? Math.round((clicked / delivered) * 100) : null,
  };
}

/** Who to resend to: delivered (or at least accepted) and no open or click on record.
 *  Bounced, complained and failed are excluded — resending to a complaint is how a
 *  sending domain gets blocked. */
export function unopened(rows: RecipientStatus[]): RecipientStatus[] {
  return rows.filter(r => (r.state === 'sent' || r.state === 'delivered') && !r.openedAt && !r.clickedAt);
}

/** Addresses a bulk send must skip: anyone who complained (marked as spam) or hard-bounced.
 *  Mailing them again is how a sending domain gets blocked. Soft/transient bounces stay. */
export function suppressedAddresses(events: Array<Pick<EventRow, 'type' | 'recipient' | 'detail'>>): Set<string> {
  const out = new Set<string>();
  for (const e of events) {
    if (!e.recipient) continue;
    const hard = e.type === 'bounced' && !/transient|soft/i.test(e.detail || '');
    if (e.type === 'complained' || hard) out.add(e.recipient.toLowerCase());
  }
  return out;
}
