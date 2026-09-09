import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';
import { NAV_TAB_IDS } from '@/lib/nav-tabs';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Per-member page grants — `athlete_tab_grants` (migration 099).
//
// The roster needs every grant in the club at once (it renders 25 rows and each
// one has to state its own additions), so GET returns the whole table rather
// than one member's. It is small by nature: a grant is the exception, and if it
// ever isn't, the answer is a role or a flag, not a thousand rows here.
//
// Staff-only on BOTH verbs, unlike role_tab_permissions where GET is open. That
// table says what a ROLE can reach — public shape. This one names people and
// what they personally may open, which is nobody else's business.

/**
 * Which tabs may be granted: the nav's own list, so the API can't be talked into
 * a page that doesn't exist. From `@/lib/nav-tabs` rather than ALL_NAV_ITEMS
 * itself — nav-items is a client module, and importing the array across that
 * boundary yields a reference proxy, not an array (see nav-tabs.ts).
 */
const GRANTABLE = new Set<string>(NAV_TAB_IDS);

// A table nobody has created yet is an empty answer, not a 500 — migrations in
// this project are pasted in by hand, so the code always lands before the DDL.
const MISSING_TABLE = '42P01';

export async function GET(request: Request) {
  try {
    const auth = await requireSession(request);
    if (!auth.ok) return authError(auth);
    if (!auth.user.isStaff) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('athlete_tab_grants')
      .select('athlete_id, tab, created_at, created_by')
      .order('athlete_id');

    if (error) {
      if (error.code === MISSING_TABLE) return NextResponse.json({ grants: [], ready: false });
      throw error;
    }

    return NextResponse.json({
      grants: (data || []).map(g => ({
        athleteId: g.athlete_id,
        tab: g.tab,
        createdAt: g.created_at,
        createdBy: g.created_by,
      })),
      ready: true,
    });
  } catch (error) {
    console.error('Failed to fetch tab grants:', error);
    return NextResponse.json({ error: 'Failed to fetch tab grants' }, { status: 500 });
  }
}

/**
 * Grant or revoke one page for one member.
 *
 * `granted: false` DELETES the grant — it does not write a deny. There is no
 * deny to write: the table has no `enabled` column on purpose, so the worst this
 * endpoint can do is return a member to exactly what their role and flags give
 * everyone like them.
 */
export async function PUT(request: Request) {
  try {
    const auth = await requireSession(request);
    if (!auth.ok) return authError(auth);
    if (!auth.user.isStaff) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }

    const { athleteId, tab, granted } = await request.json();

    if (!athleteId || !tab || typeof granted !== 'boolean') {
      return NextResponse.json({ error: 'athleteId, tab, and granted are required' }, { status: 400 });
    }
    // Rejected rather than stored: an unknown tab is inert in the nav, so it
    // would sit in the table looking like access somebody has and reading like a
    // bug on this screen forever.
    if (!GRANTABLE.has(tab)) {
      return NextResponse.json({ error: `Unknown tab: ${tab}` }, { status: 400 });
    }

    const supabase = createServerClient();

    const { error } = granted
      ? await supabase
          .from('athlete_tab_grants')
          // Idempotent: granting a page somebody already has is a no-op, which
          // is what a double tap on the roster should be.
          .upsert(
            { athlete_id: athleteId, tab, created_by: auth.user.email || null },
            { onConflict: 'athlete_id,tab' },
          )
      : await supabase.from('athlete_tab_grants').delete().eq('athlete_id', athleteId).eq('tab', tab);

    if (error) {
      if (error.code === MISSING_TABLE) {
        return NextResponse.json({ error: 'Migration 099 has not been applied yet' }, { status: 503 });
      }
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to update tab grant:', error);
    return NextResponse.json({ error: 'Failed to update tab grant' }, { status: 500 });
  }
}
