import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireApprover } from '@/lib/auth/require-approver';

export const dynamic = 'force-dynamic';

// GET /api/admin/recurring-surveys — staff-only. All team-day poll templates
// (migration 073), so the admin UI can show Tuesday's and Friday's content
// independently and edit each without touching code.
export async function GET() {
  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('recurring_survey_templates')
      .select('*')
      .order('day_of_week', { ascending: true });
    if (error) throw error;
    return NextResponse.json({ templates: data || [] });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// PATCH /api/admin/recurring-surveys { dayOfWeek, questionHe, questionEn?, optionsHe, optionsEn?, active? }
// Upserts by day_of_week — each team day's template is independently
// editable; changing Tuesday's never touches Friday's row.
export async function PATCH(request: Request) {
  try {
    const { denied } = await requireApprover(request);
    if (denied) return denied;

    const body = await request.json();
    const { dayOfWeek, questionHe, questionEn, optionsHe, optionsEn, active } = body;
    if (typeof dayOfWeek !== 'number' || dayOfWeek < 0 || dayOfWeek > 6) {
      return NextResponse.json({ error: 'dayOfWeek (0-6) is required' }, { status: 400 });
    }
    if (!questionHe?.trim()) {
      return NextResponse.json({ error: 'questionHe is required' }, { status: 400 });
    }
    const cleanOptionsHe = (optionsHe || []).map((o: string) => o.trim()).filter(Boolean);
    if (cleanOptionsHe.length < 2) {
      return NextResponse.json({ error: 'At least 2 options are required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('recurring_survey_templates')
      .upsert({
        day_of_week: dayOfWeek,
        question_he: questionHe.trim(),
        question_en: questionEn?.trim() || null,
        options_he: cleanOptionsHe,
        options_en: (optionsEn || []).map((o: string) => o.trim()).filter(Boolean) || null,
        active: active !== false,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'day_of_week' })
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({ template: data });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
