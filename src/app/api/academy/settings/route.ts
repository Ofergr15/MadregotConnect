import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { normalizeSettings, DEFAULT_ACADEMY_SETTINGS } from '@/lib/academy/settings';
import { loadAcademySettings } from '@/lib/academy/settings-server';
import { isAcademyManager, requireAcademyManager } from '@/lib/academy/pairing-server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';


/**
 * GET /api/academy/settings → the coach's academy settings (defaults if unset).
 *
 * Staff only, and the report's recipient addresses for the manager only (launch BL9 / N8b):
 * the route was anonymous, so anyone could read the weekly report's email list.
 */
export async function GET(request: Request) {
  const { denied, caller } = await requireStaffCaller(request);
  if (denied) return denied;
  const settings = await loadAcademySettings();
  if (isAcademyManager(caller)) return NextResponse.json({ settings });
  return NextResponse.json({ settings: { ...settings, report: { ...settings.report, recipients: [] } } });
}

/** PUT /api/academy/settings — upsert the settings blob. */
export async function PUT(request: Request) {
  try {
    // The manager's: these settings grade every coach's trainees, and the tab
    // that edits them is the manager's alone.
    const { denied } = await requireAcademyManager(request);
    if (denied) return denied;

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
