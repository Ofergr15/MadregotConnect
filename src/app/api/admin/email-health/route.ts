import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth/self-or-staff';
import { diagnoseEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/admin/email-health — is outbound mail actually working, and what happened
 * to the last few.
 *
 * The reason this endpoint exists rather than a doc note: the state that broke the
 * launch was invisible from inside the app. Production had an API key, so every check
 * said "configured", while the sender was Resend's sandbox address and every send to a
 * club member was refused. Nobody would ever have thought to look, so the screen has
 * to say it unprompted.
 *
 * ⚠️ Staff-gated. It returns recipient addresses out of email_log — including people
 * who applied and were turned down — and the config's FROM address. Never widen this
 * to members.
 */
export async function GET(request: Request) {
  const denied = await requireStaff(request);
  if (denied) return denied;

  // The config half needs no database and must answer even when the log table is
  // missing — it is the half that diagnoses the failure we actually hit.
  const health = diagnoseEmail();

  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  let counts: Record<string, number> = {};
  let recent: Array<Record<string, unknown>> = [];
  let logged = true;

  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('email_log')
      .select('id, created_at, template, recipients, status, error_code, error_message')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      // 42P01 = migration 096 not applied yet. Migrations here are pasted in by hand,
      // so this is a real state — and the config diagnosis above is still worth
      // returning, which is why this doesn't 500.
      if (error.code === '42P01') logged = false;
      else throw error;
    } else {
      for (const row of data || []) {
        counts[row.status as string] = (counts[row.status as string] || 0) + 1;
      }
      // Only the ones worth acting on. A list of successes is noise; a list of
      // refusals and bounces is a worklist.
      recent = (data || [])
        .filter(r => ['refused', 'failed', 'bounced', 'complained'].includes(r.status as string))
        .slice(0, 20)
        .map(r => ({
          id: r.id,
          at: r.created_at,
          template: r.template,
          to: r.recipients,
          status: r.status,
          code: r.error_code,
          message: r.error_message,
        }));
    }
  } catch (err) {
    console.error('email-health could not read email_log:', err);
    logged = false;
    counts = {};
  }

  const failed = ['refused', 'failed', 'bounced', 'complained'].reduce((a, k) => a + (counts[k] || 0), 0);

  return NextResponse.json({
    health,
    /** false = migration 096 has not been applied, so there is no history to show. */
    logged,
    window: '30d',
    counts,
    failed,
    recent,
  });
}
