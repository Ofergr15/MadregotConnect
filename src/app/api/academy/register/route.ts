import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { notifyAdminNewAcademyRegistration } from '@/lib/email';

export const dynamic = 'force-dynamic';

/**
 * POST /api/academy/register — public academy sign-up.
 * Body: { name, email, phone? }
 * Creates an unapproved academy applicant and emails the coach to review.
 * After approval (existing /api/admin/approve + Settings queue), the applicant
 * gets a link to /join/academy/{token} to connect Garmin.
 */
export async function POST(request: Request) {
  try {
    const { name, email, phone, intake } = await request.json();
    if (!name?.trim() || !email?.trim()) {
      return NextResponse.json({ error: 'Name and email are required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const normEmail = email.toLowerCase().trim();

    // Reuse an existing row for this email if present (re-registration), else insert.
    const { data: existing } = await supabase
      .from('athletes')
      .select('id, approved, invite_token')
      .eq('coach_id', COACH_ID)
      .eq('email', normEmail)
      .maybeSingle();

    const token = existing?.invite_token || randomBytes(16).toString('hex');

    const row: Record<string, any> = {
      coach_id: COACH_ID,
      name: name.trim(),
      email: normEmail,
      phone: phone?.trim() || null,
      status: 'invited',
      is_academy: true,
      role: 'academy_user',
      approved: false,
      onboarding_status: 'academy_pending',
      invite_token: token,
      academy_intake: intake && typeof intake === 'object' ? intake : null,
    };

    let error;
    if (existing) {
      ({ error } = await supabase.from('athletes').update(row).eq('id', existing.id));
    } else {
      ({ error } = await supabase.from('athletes').insert(row));
    }
    // If some columns don't exist yet (unmigrated), retry with the minimal set.
    if (error) {
      const minimal = { coach_id: COACH_ID, name: name.trim(), email: normEmail, status: 'invited', invite_token: token };
      if (existing) ({ error } = await supabase.from('athletes').update(minimal).eq('id', existing.id));
      else ({ error } = await supabase.from('athletes').insert(minimal));
      if (error) throw error;
    }

    try {
      await notifyAdminNewAcademyRegistration({ name: name.trim(), email: normEmail, phone });
    } catch (e) {
      console.error('Academy registration email failed:', e);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Academy register error:', error);
    return NextResponse.json({ error: error.message || 'Registration failed' }, { status: 500 });
  }
}
