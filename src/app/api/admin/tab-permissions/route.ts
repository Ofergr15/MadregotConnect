import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET stays open: Header and BottomTabBar read it on every page load, including
// before an athlete's session resolves, and it only reveals which tabs a role
// can see. PUT is staff-only — it decides what every role in the club can reach.

// ── Why this is memoised ─────────────────────────────────────────────────────
// It sits on the critical path of every single screen (the nav can't render
// without it) and it was measured at 994 ms cold / 394 ms warm — against a
// ~390 ms Supabase round trip from a dev machine, i.e. essentially all latency
// and no work. The content is the club's role→tab matrix: a couple of dozen
// rows that change when somebody redesigns the nav, so about monthly.
//
// The TTL is nonetheless kept short, because the one person who ever notices
// staleness here is the admin who just toggled a checkbox in
// /dashboard/settings — and their own PUT clears it below, so on the instance
// they are talking to they see the change immediately. 30 s is the worst case
// for a SECOND instance that already had the old answer warm.
//
// Deliberately NOT a `Cache-Control: s-maxage` on top (unlike
// /api/public/stats): a CDN copy can't be invalidated by the PUT, so the same
// admin would toggle a tab and keep being served the old matrix from the edge
// with no way to force it. An in-process memo is the layer a write can reach.
//
// Kept module-private and cleared inline by the PUT rather than exposed as an
// exported helper: Next rejects any export from a route file that isn't a
// method or a known config field.
const MEMO_TTL_MS = 30_000;
let memo: { permissions: unknown[]; expires: number } | null = null;

export async function GET() {
  try {
    if (memo && memo.expires > Date.now()) {
      return NextResponse.json({ permissions: memo.permissions });
    }

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('role_tab_permissions')
      .select('role, tab, enabled')
      .order('role')
      .order('tab');

    if (error) throw error;

    // Only a read that answered. The catch below returns a 500 rather than an
    // empty matrix, so there is no all-tabs-hidden state to memoise here.
    const permissions = data || [];
    memo = { permissions, expires: Date.now() + MEMO_TTL_MS };

    return NextResponse.json({ permissions });
  } catch (error) {
    console.error('Failed to fetch tab permissions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tab permissions' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await requireSession(request);
    if (!auth.ok) return authError(auth);
    if (!auth.user.isStaff) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }

    const supabase = createServerClient();
    const body = await request.json();
    const { role, tab, enabled } = body;

    if (!role || !tab || typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'role, tab, and enabled are required' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('role_tab_permissions')
      .upsert({ role, tab, enabled }, { onConflict: 'role,tab' });

    if (error) throw error;

    // Before answering, so the settings screen's own refetch cannot beat the
    // invalidation and paint the checkbox back to where it was.
    memo = null;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to update tab permission:', error);
    return NextResponse.json(
      { error: 'Failed to update tab permission' },
      { status: 500 }
    );
  }
}
