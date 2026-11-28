import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';
import { isMissingColumn } from '@/lib/supabase/schema-drift';
import { intakeLines } from '@/lib/join/intake';
import { suggestGroup } from '@/lib/join/suggest-group';
import { loadPackGoals } from './load';

export const dynamic = 'force-dynamic';

const PAGE_MAX = 200;

/**
 * GET /api/admin/join-requests — pending join requests, oldest first, each with the pack
 * its best time suggests (lib/join/suggest-group). Approvers only (`canApprove`, the same
 * gate as /api/admin/registrations/approve; off while viewing-as).
 *
 * Decide with POST /api/admin/join-requests/{id}/decision. Read-only.
 */
export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.canApprove) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  try {
    const db = createServerClient();
    const cols = 'id, email, full_name, group_id, created_at, intake';
    const pending = (select: string) =>
      db.from('signup_requests').select(select).eq('status', 'pending').order('created_at', { ascending: true }).limit(PAGE_MAX);
    let res = await pending(cols);
    // Before 131/158: no name, no intake — still a queue, just without suggestions.
    if (res.error && isMissingColumn(res.error)) res = await pending('id, email, group_id, created_at');
    if (res.error) throw res.error;
    const groups = await loadPackGoals(db);
    const rows = (res.data || []) as unknown as Array<{ id: string; email: string; full_name?: string | null; group_id: string | null; created_at: string; intake?: unknown }>;
    return NextResponse.json({
      requests: rows.map((r) => ({
        id: r.id,
        email: r.email,
        fullName: r.full_name ?? null,
        requestedGroupId: r.group_id,
        createdAt: r.created_at,
        intake: intakeLines(r.intake),
        suggestion: suggestGroup(r.intake, groups),
      })),
      truncated: rows.length === PAGE_MAX,
    });
  } catch (err) {
    console.error('GET /api/admin/join-requests failed:', err);
    return NextResponse.json({ error: 'Failed to load join requests' }, { status: 500 });
  }
}
