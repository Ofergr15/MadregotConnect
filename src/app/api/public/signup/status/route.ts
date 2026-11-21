import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { APPROVER_EMAILS } from '@/lib/constants';
import { recipientsForKind } from '@/lib/notifications/routing';
import { mintMemberSession } from '@/lib/auth/member-session';
import { groupDisplayName, resolveGroup } from '@/lib/utils';
import { firstNames, publicStatusFor, rateLimited, statusSecretMatches } from '@/lib/onboarding/signup-status';

export const dynamic = 'force-dynamic';

/**
 * POST /api/public/signup/status — PUBLIC, keyed by the applicant's secret (gap 2).
 *   { id, secret }                → { status, approvers, createdAt, notify, group?, approvedBy?, session? }
 *   { id, secret, notify: true }  → same, after recording the "להודיע לי" opt-in (gap 3)
 *
 * POST and not the brief's GET: the secret is a credential (it can mint a session once)
 * and query strings end up in access logs.
 *
 * The secret is 256 random bits issued once by POST /api/public/signup to the
 * submission that created the row; only its hash is stored (migration 189). A wrong
 * id and a wrong secret answer the same 404, so the route cannot confirm request ids.
 *
 * `approvers` (gap 7, decision 2026-11-21): FIRST NAMES of the staff this request is
 * routed to — recipientsForKind('signup_request'), the routing that pushes them.
 * null (unconfigured) → the mail's own fallback, APPROVER_EMAILS. [] → []. Never an
 * email or id. Recorded as an exposure change in CLAUDE.md.
 *
 * `session` appears ONCE, on the first poll that sees the approval: the member lands
 * signed in without typing their address. status_grant_used_at is claimed atomically
 * before minting, so two polls cannot both get one. After that: sign in by code.
 */
type Db = ReturnType<typeof createServerClient>;

async function approverFirstNames(supabase: Db): Promise<string[]> {
  try {
    const ids = await recipientsForKind('signup_request', supabase);
    if (ids === null) {
      const { data } = await supabase.from('athletes').select('name, email').in('email', APPROVER_EMAILS);
      // The order of the list, not of the table — the first approver named first.
      const rows = ((data || []) as Array<{ name: string | null; email: string }>).sort(
        (a, b) => APPROVER_EMAILS.indexOf(a.email) - APPROVER_EMAILS.indexOf(b.email),
      );
      return firstNames(rows.map((r) => r.name));
    }
    if (ids.length === 0) return [];
    const { data } = await supabase.from('athletes').select('name').in('id', ids);
    return firstNames(((data || []) as Array<{ name: string | null }>).map((r) => r.name));
  } catch {
    return [];
  }
}

const notFound = () => NextResponse.json({ error: 'not-found' }, { status: 404 });

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { id?: unknown; secret?: unknown; notify?: unknown };
  const id = typeof body.id === 'string' && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null;
  if (!id) return notFound();
  const client = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (rateLimited(`id:${id}`) || rateLimited(`ip:${client}`)) {
    return NextResponse.json({ error: 'too-many' }, { status: 429, headers: { 'Retry-After': '60' } });
  }

  try {
    const supabase = createServerClient();
    const { data: row, error } = await supabase
      .from('signup_requests')
      .select('id, status, created_at, status_secret_hash, status_grant_used_at, notify_opt_in_at, athlete_id, group_id, approved_by')
      .eq('id', id)
      .maybeSingle();
    // Pre-189 there is no secret column, so nobody holds a valid secret yet: 404 is true.
    if (error || !row || !statusSecretMatches(body.secret, row.status_secret_hash as string | null)) return notFound();

    let notifyAt = row.notify_opt_in_at as string | null;
    if (body.notify === true && !notifyAt) {
      notifyAt = new Date().toISOString();
      await supabase.from('signup_requests').update({ notify_opt_in_at: notifyAt }).eq('id', id);
    }

    const status = publicStatusFor(row.status as string);
    const out: Record<string, unknown> = {
      status,
      createdAt: row.created_at,
      // What exists today: the approval email (every approval sends one) plus this poll.
      notify: notifyAt ? 'email' : null,
      approvers: status === 'pending' ? await approverFirstNames(supabase) : [],
    };

    if (status === 'approved' && row.athlete_id) {
      const { data: member } = await supabase
        .from('athletes')
        .select('id, email, name, group_id, status, approved, role, is_academy')
        .eq('id', row.athlete_id)
        .maybeSingle();
      if (member && member.approved === true && member.status !== 'removed' && member.status !== 'disconnected') {
        if (member.group_id) {
          const { data: g } = await supabase.from('groups').select('id, name').eq('id', member.group_id).maybeSingle();
          if (g) out.group = { id: g.id, name: groupDisplayName(g.name), index: resolveGroup(g.name).index };
        }
        if (row.approved_by) {
          const { data: by } = await supabase.from('athletes').select('name').eq('email', row.approved_by).maybeSingle();
          out.approvedBy = firstNames([by?.name])[0] ?? null;
        }
        if (!row.status_grant_used_at) {
          const { data: claimed } = await supabase
            .from('signup_requests')
            .update({ status_grant_used_at: new Date().toISOString() })
            .eq('id', id)
            .is('status_grant_used_at', null)
            .select('id');
          if (claimed && claimed.length > 0) {
            const minted = await mintMemberSession(supabase, member as never);
            if (minted.ok) out.session = minted.body;
            else {
              // Give the grant back so the next poll can try again.
              console.error('[signup/status] session mint failed:', minted.error);
              await supabase.from('signup_requests').update({ status_grant_used_at: null }).eq('id', id);
            }
          }
        }
      }
    }
    return NextResponse.json(out);
  } catch (err) {
    console.error('[signup/status] failed:', err);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
