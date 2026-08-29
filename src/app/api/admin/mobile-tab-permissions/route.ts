import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Same split as /api/admin/tab-permissions: open GET (the tab bar needs it on
// every load), staff-only PUT.

export async function GET() {
  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('role_mobile_tab_permissions')
      .select('role, tab, enabled')
      .order('role')
      .order('tab');

    if (error) throw error;

    return NextResponse.json({ permissions: data || [] });
  } catch (error) {
    console.error('Failed to fetch mobile tab permissions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch mobile tab permissions' },
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
      .from('role_mobile_tab_permissions')
      .upsert({ role, tab, enabled }, { onConflict: 'role,tab' });

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to update mobile tab permission:', error);
    return NextResponse.json(
      { error: 'Failed to update mobile tab permission' },
      { status: 500 }
    );
  }
}
