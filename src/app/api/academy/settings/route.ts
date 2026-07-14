import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { normalizeSettings, DEFAULT_ACADEMY_SETTINGS } from '@/lib/academy/settings';
import { loadAcademySettings } from '@/lib/academy/settings-server';

export const dynamic = 'force-dynamic';

/** GET /api/academy/settings → the coach's academy settings (defaults if unset). */
export async function GET() {
  const settings = await loadAcademySettings();
  return NextResponse.json({ settings });
}

/** PUT /api/academy/settings — upsert the settings blob. */
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const settings = normalizeSettings(body.settings ?? body);

    const supabase = createServerClient();
    const { error } = await supabase
      .from('academy_settings')
      .upsert({ coach_id: COACH_ID, settings, updated_at: new Date().toISOString() }, { onConflict: 'coach_id' });

    if (error) {
      console.error('Academy settings PUT error:', error);
      return NextResponse.json({ error: 'Failed to save settings', details: error.message }, { status: 500 });
    }
    return NextResponse.json({ settings });
  } catch (error: any) {
    console.error('Academy settings PUT error:', error);
    return NextResponse.json({ error: error.message || 'Failed to save settings', settings: DEFAULT_ACADEMY_SETTINGS }, { status: 500 });
  }
}
