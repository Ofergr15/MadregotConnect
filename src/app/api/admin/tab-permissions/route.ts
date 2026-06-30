import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('role_tab_permissions')
      .select('role, tab, enabled')
      .order('role')
      .order('tab');

    if (error) throw error;

    return NextResponse.json({ permissions: data || [] });
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

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to update tab permission:', error);
    return NextResponse.json(
      { error: 'Failed to update tab permission' },
      { status: 500 }
    );
  }
}
