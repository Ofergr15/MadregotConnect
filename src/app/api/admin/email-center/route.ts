import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller, type VerifiedCaller } from '@/lib/auth/self-or-staff';
import { isFeatureEnabled } from '@/lib/features/server';
import { sendEmail } from '@/lib/email/send';
import {
  newsletterEmail, welcomeEmail, registrationDeclinedEmail, SAMPLE_NEWSLETTER, cleanNewsletter,
  type BuiltEmail, type NewsletterInput,
} from '@/lib/email/club-mail';
import { recipientStatuses, campaignTotals, unopened, suppressedAddresses, type LogRow } from '@/lib/email/tracking';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * /api/admin/email-center — b25 club email center (flag `email_center`, migration 222).
 *
 *   GET  ?preview=welcome|newsletter|declined   → { subject, html } (sample data)
 *   GET                                        → campaigns with totals + transactional mail by template (30 days)
 *   GET  ?campaign=<id>                        → per-recipient status + who hasn't opened
 *   POST { action: 'preview', input }          → { subject, html } of a composed newsletter
 *   POST { action: 'test', kind, input?, campaignId? } → sends ONE copy to the caller's own address
 *   POST { action: 'create', input }           → a draft campaign
 *   POST { action: 'send', campaignId, confirm: 'שלח לכולם' } → every active member; needs a prior test
 *   POST { action: 'resend_unopened', campaignId, confirm: 'שלח לכולם' } → only who hasn't opened
 *
 * ⚠️ ADMIN-ONLY (isSuperUser || role === 'admin'), stricter than requireStaff — same
 * reasoning as /api/admin/notifications: it reads every member's address and who opened
 * what, and its POST mails the whole club. Off flag → 404, so the surface does not
 * exist until the owner turns it on. A test goes only to the CALLER's own verified
 * address; no body field can name a recipient.
 */

const CONFIRM = 'שלח לכולם';
const MAX_RECIPIENTS = 400;
/** Resend's default rate limit is 2 requests/s. */
const SPACING_MS = 550;
/** Stop starting new sends well before maxDuration (300 s) so the campaign row is always
 *  closed out; otherwise a killed function leaves it in 'sending' forever. */
const SEND_BUDGET_MS = 240_000;

async function gate(request: Request): Promise<{ denied: Response | null; caller: VerifiedCaller }> {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return { denied, caller };
  if (!caller.isSuperUser && caller.role !== 'admin') {
    return { denied: NextResponse.json({ error: 'Admin access required' }, { status: 403 }), caller };
  }
  if (!(await isFeatureEnabled('email_center', caller.athleteId).catch(() => false))) {
    return { denied: NextResponse.json({ error: 'Not found' }, { status: 404 }), caller };
  }
  return { denied: null, caller };
}

const missingTable = (e: { code?: string } | null) => e?.code === '42P01';
const notReady = () => NextResponse.json({ ready: false, error: 'migration 222 not applied' }, { status: 503 });

function build(kind: string, input: NewsletterInput | null, name?: string | null): BuiltEmail | null {
  if (kind === 'welcome') return welcomeEmail({ name, coachName: null, groupName: null });
  if (kind === 'declined') return registrationDeclinedEmail({ name });
  if (kind === 'newsletter') return newsletterEmail({ ...(input || SAMPLE_NEWSLETTER), name });
  return null;
}

const UNSUBSCRIBE = { 'List-Unsubscribe': `<mailto:${process.env.ADMIN_EMAIL || 'madregot.club@gmail.com'}?subject=unsubscribe>` };

async function campaignRecipients(db: ReturnType<typeof createServerClient>, campaignId: string) {
  const logs = await db
    .from('email_log')
    .select('id, created_at, recipients, status, provider_id, athlete_id, error_code')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: true })
    .limit(2000);
  if (logs.error) return { error: logs.error };
  const ids = (logs.data || []).map(l => l.provider_id).filter(Boolean) as string[];
  let events: Array<{ type: string; provider_id: string; occurred_at: string }> = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from('email_events').select('type, provider_id, occurred_at').in('provider_id', ids.slice(i, i + 200)).limit(5000);
    if (error) return { error };
    events = events.concat(data || []);
  }
  return { rows: recipientStatuses((logs.data || []) as LogRow[], events as never) };
}

export async function GET(request: Request) {
  try {
    const { denied } = await gate(request);
    if (denied) return denied;
    const { searchParams } = new URL(request.url);

    const preview = searchParams.get('preview');
    if (preview) {
      const built = build(preview, null, 'דנה');
      return built ? NextResponse.json(built) : NextResponse.json({ error: 'unknown preview' }, { status: 400 });
    }

    const db = createServerClient();
    const campaignId = searchParams.get('campaign');
    if (campaignId) {
      const { data: campaign, error } = await db.from('email_campaigns').select('*').eq('id', campaignId).maybeSingle();
      if (missingTable(error)) return notReady();
      if (error) return NextResponse.json({ error: 'read failed' }, { status: 500 });
      if (!campaign) return NextResponse.json({ error: 'not found' }, { status: 404 });
      const res = await campaignRecipients(db, campaignId);
      if ('error' in res && res.error) return NextResponse.json({ error: 'read failed' }, { status: 500 });
      const rows = res.rows || [];
      // Names for the list — read here, never stored in email_events.
      const athleteIds = [...new Set(rows.map(r => r.athleteId).filter(Boolean))] as string[];
      const names: Record<string, string> = {};
      if (athleteIds.length) {
        const { data } = await db.from('athletes').select('id, name').in('id', athleteIds);
        for (const a of data || []) names[a.id as string] = (a.name as string) || '';
      }
      const withNames = rows.map(r => ({ ...r, name: r.athleteId ? names[r.athleteId] || null : null }));
      return NextResponse.json({
        ready: true,
        campaign,
        totals: campaignTotals(rows),
        recipients: withNames,
        unopened: unopened(rows).map(r => r.logId),
      });
    }

    const { data: campaigns, error } = await db
      .from('email_campaigns')
      .select('id, created_at, created_by_email, kind, subject, status, tested_at, sent_at, recipient_count, parent_id')
      .order('created_at', { ascending: false })
      .limit(30);
    if (missingTable(error)) return notReady();
    if (error) return NextResponse.json({ error: 'read failed' }, { status: 500 });

    const out = [];
    for (const c of campaigns || []) {
      const res = c.status === 'draft' ? { rows: [] } : await campaignRecipients(db, c.id as string);
      out.push({ ...c, totals: campaignTotals(res.rows || []) });
    }

    // Transactional mail (no campaign), grouped by template over 30 days.
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const tx = await db
      .from('email_log')
      .select('id, created_at, template, recipients, status, provider_id, athlete_id, error_code')
      .is('campaign_id', null)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1000);
    const byTemplate: Record<string, LogRow[]> = {};
    for (const l of tx.data || []) (byTemplate[l.template as string] ||= []).push(l as LogRow);
    const ids = (tx.data || []).map(l => l.provider_id).filter(Boolean) as string[];
    let events: Array<{ type: string; provider_id: string; occurred_at: string }> = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await db.from('email_events').select('type, provider_id, occurred_at').in('provider_id', ids.slice(i, i + 200)).limit(5000);
      events = events.concat(data || []);
    }
    const transactional = Object.entries(byTemplate).map(([template, logs]) => ({
      template,
      totals: campaignTotals(recipientStatuses(logs, events as never)),
    })).sort((a, b) => b.totals.recipients - a.totals.recipients);

    return NextResponse.json({ ready: true, campaigns: out, transactional });
  } catch (error: any) {
    console.error('email-center GET failed:', error);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}

async function sendTo(
  db: ReturnType<typeof createServerClient>,
  campaignId: string,
  input: NewsletterInput,
  people: Array<{ id: string | null; name: string | null; email: string }>,
  now: () => number = Date.now,
) {
  const started = now();
  let sent = 0, failed = 0, attempted = 0;
  try {
    for (let i = 0; i < people.length; i++) {
      if (now() - started > SEND_BUDGET_MS) break;
      const p = people[i];
      const built = newsletterEmail({ ...input, name: p.name });
      const r = await sendEmail({
        template: 'newsletter', to: p.email, subject: built.subject, html: built.html,
        athleteId: p.id, campaignId, headers: UNSUBSCRIBE,
      });
      attempted++;
      if (r.ok) sent++; else failed++;
      if (i < people.length - 1) await new Promise(res => setTimeout(res, SPACING_MS));
    }
  } finally {
    // Always close the row out — 'sending' is a lock, and a stuck lock blocks nothing
    // visibly but lies on the screen. recipient_count is who was actually attempted.
    await db.from('email_campaigns').update({ status: 'sent', sent_at: new Date().toISOString(), recipient_count: attempted }).eq('id', campaignId);
  }
  return { sent, failed, notAttempted: people.length - attempted };
}

/** Complained / hard-bounced addresses, from the webhook events. Read failure → empty
 *  set (the send still happens; the screen shows the bounces afterwards). */
async function suppressionList(db: ReturnType<typeof createServerClient>): Promise<Set<string>> {
  const { data, error } = await db.from('email_events').select('type, recipient, detail').in('type', ['complained', 'bounced']).limit(5000);
  if (error) return new Set();
  return suppressedAddresses((data || []) as never);
}

export async function POST(request: Request) {
  try {
    const { denied, caller } = await gate(request);
    if (denied) return denied;
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || '');
    const db = createServerClient();

    if (action === 'preview') {
      const input = cleanNewsletter(body.input);
      if (!input) return NextResponse.json({ error: 'title required' }, { status: 400 });
      return NextResponse.json(newsletterEmail(input));
    }

    if (action === 'test') {
      // To the caller only — the address comes from the verified session, never the body.
      if (!caller.email) return NextResponse.json({ error: 'no address on this account' }, { status: 400 });
      const kind = String(body.kind || 'newsletter');
      // A campaign's test is of the campaign's STORED content — what "send" will mail.
      let stored: unknown = body.input;
      if (body.campaignId) {
        const { data } = await db.from('email_campaigns').select('input').eq('id', String(body.campaignId)).maybeSingle();
        if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });
        stored = data.input;
      }
      const input = kind === 'newsletter' ? cleanNewsletter(stored) : null;
      const built = build(kind, input, null);
      if (!built) return NextResponse.json({ error: 'unknown kind' }, { status: 400 });
      const r = await sendEmail({
        template: 'email_center_test', to: caller.email, subject: `[בדיקה] ${built.subject}`, html: built.html,
        athleteId: caller.athleteId,
      });
      if (r.ok && body.campaignId) {
        await db.from('email_campaigns').update({ status: 'tested', tested_at: new Date().toISOString() })
          .eq('id', String(body.campaignId)).in('status', ['draft', 'tested']);
      }
      return NextResponse.json({ ok: r.ok, status: r.status, to: caller.email, ...(r.ok ? {} : { reason: r.reason }) });
    }

    if (action === 'create') {
      const input = cleanNewsletter(body.input);
      if (!input) return NextResponse.json({ error: 'title required' }, { status: 400 });
      const { data, error } = await db.from('email_campaigns').insert({
        created_by_email: caller.email, kind: 'newsletter', subject: newsletterEmail(input).subject, input, status: 'draft',
      }).select('id').single();
      if (missingTable(error)) return notReady();
      if (error) return NextResponse.json({ error: 'create failed' }, { status: 500 });
      return NextResponse.json({ id: data.id });
    }

    if (action === 'send' || action === 'resend_unopened') {
      if (body.confirm !== CONFIRM) return NextResponse.json({ error: `type "${CONFIRM}" to confirm` }, { status: 400 });
      const campaignId = String(body.campaignId || '');
      const { data: campaign, error } = await db.from('email_campaigns').select('*').eq('id', campaignId).maybeSingle();
      if (missingTable(error)) return notReady();
      if (error) return NextResponse.json({ error: 'read failed' }, { status: 500 });
      if (!campaign) return NextResponse.json({ error: 'not found' }, { status: 404 });
      const input = cleanNewsletter(campaign.input);
      if (!input) return NextResponse.json({ error: 'campaign has no content' }, { status: 400 });

      if (action === 'send') {
        // Nothing goes to everyone without a test having reached the admin first.
        if (campaign.status !== 'tested') return NextResponse.json({ error: 'send a test to yourself first' }, { status: 409 });
        // Claim it: only one request can move tested → sending.
        const claim = await db.from('email_campaigns').update({ status: 'sending' }).eq('id', campaignId).eq('status', 'tested').select('id');
        if (claim.error || !(claim.data || []).length) return NextResponse.json({ error: 'already sending' }, { status: 409 });
        const { data: roster, error: rErr } = await db.from('athletes').select('id, name, email').eq('status', 'active').limit(MAX_RECIPIENTS + 1);
        if (rErr) {
          await db.from('email_campaigns').update({ status: 'tested' }).eq('id', campaignId);
          return NextResponse.json({ error: 'roster read failed' }, { status: 500 });
        }
        const suppressed = await suppressionList(db);
        const seen = new Set<string>(suppressed);
        const people = (roster || [])
          .map(a => ({ id: a.id as string, name: (a.name as string) || null, email: String(a.email || '').trim().toLowerCase() }))
          .filter(a => a.email.includes('@') && !a.email.endsWith('.local') && !seen.has(a.email) && seen.add(a.email))
          .slice(0, MAX_RECIPIENTS);
        const res = await sendTo(db, campaignId, input, people);
        return NextResponse.json({ ok: true, recipients: people.length, ...res });
      }

      // resend_unopened: a child campaign to exactly who hasn't opened the parent.
      // Only once per campaign, only after the parent finished sending — a double click
      // (or a second admin) must not nudge the same people twice.
      if (campaign.status !== 'sent' || campaign.kind !== 'newsletter') {
        return NextResponse.json({ error: 'only a sent newsletter can be resent' }, { status: 409 });
      }
      const prior = await db.from('email_campaigns').select('id').eq('parent_id', campaignId).limit(1);
      if (prior.error) return NextResponse.json({ error: 'read failed' }, { status: 500 });
      if ((prior.data || []).length) return NextResponse.json({ error: 'already resent once' }, { status: 409 });
      const parent = await campaignRecipients(db, campaignId);
      if ('error' in parent && parent.error) return NextResponse.json({ error: 'read failed' }, { status: 500 });
      const suppressed = await suppressionList(db);
      const targets = unopened(parent.rows || []).filter(t => !suppressed.has(t.email));
      if (!targets.length) return NextResponse.json({ ok: true, recipients: 0, sent: 0, failed: 0 });
      const { data: child, error: cErr } = await db.from('email_campaigns').insert({
        created_by_email: caller.email, kind: 'resend_unopened', subject: campaign.subject, input: campaign.input,
        status: 'sending', parent_id: campaignId, tested_at: campaign.tested_at,
      }).select('id').single();
      if (cErr) return NextResponse.json({ error: 'create failed' }, { status: 500 });
      const ids = targets.map(t => t.athleteId).filter(Boolean) as string[];
      const names: Record<string, string> = {};
      if (ids.length) {
        const { data } = await db.from('athletes').select('id, name').in('id', ids);
        for (const a of data || []) names[a.id as string] = (a.name as string) || '';
      }
      const people = targets.map(t => ({ id: t.athleteId, name: t.athleteId ? names[t.athleteId] || null : null, email: t.email }));
      const res = await sendTo(db, child.id as string, input, people);
      return NextResponse.json({ ok: true, campaignId: child.id, recipients: people.length, ...res });
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (error: any) {
    console.error('email-center POST failed:', error);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
