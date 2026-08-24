import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { randomBytes } from 'crypto';
import { canApprove } from '@/lib/constants';
import { notifyUserApproved, notifyAdminUserApproved, notifyAcademyApproved } from '@/lib/email';
import { notifyAthlete } from '@/lib/push';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const { athleteId, approverEmail } = await req.json();

    if (!athleteId) {
      return NextResponse.json({ error: 'athleteId is required' }, { status: 400 });
    }

    // Only allowlisted accounts may approve new registrations. This is the
    // authoritative check — the UI also hides the button, but that's cosmetic.
    if (!canApprove(approverEmail)) {
      return NextResponse.json(
        { error: 'You are not authorized to approve registrations.' },
        { status: 403 }
      );
    }

    // Select is_academy/garmin_auth too (guarded — may be older schema).
    let athlete: any = null;
    const primary = await supabase
      .from('athletes')
      .select('id, name, email, approved, is_academy, garmin_auth, invite_token')
      .eq('id', athleteId)
      .single();
    if (primary.error) {
      const fb = await supabase.from('athletes').select('id, name, email, approved').eq('id', athleteId).single();
      athlete = fb.data;
    } else {
      athlete = primary.data;
    }

    if (!athlete) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (athlete.approved) {
      return NextResponse.json({ message: 'Already approved' });
    }

    const updates: Record<string, any> = {
      approved: true,
      approved_at: new Date().toISOString(),
      approved_by: approverEmail || null,
      status: 'active',
    };

    // Academy applicants who haven't connected Garmin yet get a fresh onboarding
    // token so the approval email can link them straight to the Garmin step.
    const isAcademyPending = athlete.is_academy && !athlete.garmin_auth;
    const token = athlete.invite_token || randomBytes(16).toString('hex');
    if (isAcademyPending) updates.invite_token = token;

    const { error: updateError } = await supabase
      .from('athletes')
      .update(updates)
      .eq('id', athleteId);

    if (updateError) throw updateError;

    // Email and push are independent channels for the same event — send
    // concurrently rather than one after the other. Each is isolated in its
    // own try/catch so a failure in one can't block or skip the other.
    await Promise.all([
      (async () => {
        try {
          if (isAcademyPending) {
            await notifyAcademyApproved({ name: athlete.name, email: athlete.email, token });
          } else {
            await notifyUserApproved({ name: athlete.name, email: athlete.email });
          }
          if (approverEmail) {
            await notifyAdminUserApproved({ email: approverEmail }, { name: athlete.name, email: athlete.email });
          }
        } catch (emailErr) {
          console.error('Email notification failed:', emailErr);
        }
      })(),
      // Push as a second, faster channel — email can sit unread for hours, and
      // this is the one moment a pending athlete has been waiting for since
      // signup (no other way today for them to learn they were approved short
      // of guessing and signing back in). No category, so it can't be muted.
      (async () => {
        try {
          await notifyAthlete({
            athleteId,
            kind: 'approval',
            title: `${athlete.name}, אושרת! 🎉`,
            body: 'ההרשמה שלך אושרה — היכנס/י כדי לראות את תוכנית האימונים שלך',
            url: '/dashboard',
            tag: 'approval',
            // No category — this is the one moment a pending athlete has been
            // waiting for since signup; it must never be mutable.
          });
        } catch (pushErr) {
          console.error('Approval push notification failed:', pushErr);
        }
      })(),
    ]);

    return NextResponse.json({ success: true, athlete: { id: athlete.id, email: athlete.email, approved: true } });
  } catch (error) {
    console.error('Failed to approve user:', error);
    return NextResponse.json({ error: 'Failed to approve user' }, { status: 500 });
  }
}
