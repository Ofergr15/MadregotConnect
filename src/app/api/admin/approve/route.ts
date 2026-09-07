import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { randomBytes } from 'crypto';
import { authError, requireSession } from '@/lib/auth-session';
import { releaseFromMaintenance } from '@/lib/maintenance-release';
import { notifyUserApproved, notifyAdminUserApproved, notifyAcademyApproved } from '@/lib/email';
import { notifyAthlete } from '@/lib/push';
import { approvalCopy } from '@/lib/notifications/copy';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireSession(req);
    if (!auth.ok) return authError(auth);

    const supabase = createServerClient();
    const { athleteId } = await req.json();

    if (!athleteId) {
      return NextResponse.json({ error: 'athleteId is required' }, { status: 400 });
    }

    // Only approvers may accept new registrations. This is the authoritative
    // check — the UI also hides the button, but that's cosmetic. The actor is the
    // VERIFIED session; it used to be read from the request body, so any anonymous
    // caller could self-approve an account by naming an approver (and
    // APPROVER_EMAILS is public — it ships in the client bundle).
    //
    // `auth.user.canApprove`, NOT canApprove(auth.user.email). The second is a
    // check against an email LITERAL and login is Strava-only, so the JWT address
    // is always the synthetic `strava_<id>@…local`: it could never match anybody,
    // and this endpoint 403'd for every approver in the club. Same bug that stuck
    // maintenance mode on with no way to turn it off. The session flag reads the
    // row's `is_approver` (migration 084) and handles exactly this.
    if (!auth.user.canApprove) {
      return NextResponse.json(
        { error: 'You are not authorized to approve registrations.' },
        { status: 403 }
      );
    }
    // The address a human would recognise — the row's, not the token's — because
    // this one is stamped into `approved_by` and emailed to the admin.
    const approverEmail = auth.user.athleteEmail || auth.user.email;

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

    // Let them through the maintenance window too, BEFORE the approval bookkeeping
    // and regardless of whether there is any approving left to do.
    //
    // Approving somebody during a window used to change nothing they could feel:
    // they went from "not approved" to "approved and still blocked", the same
    // closed door on their phone, and the two gates lived on two different screens
    // so nobody suspected it. The club keeps a window open for days at a time, so
    // this is the normal case. `released` goes back so the panel can say so.
    let released = false;
    let maintenanceOn = false;
    try {
      const outcome = await releaseFromMaintenance({ id: athlete.id, email: athlete.email });
      released = outcome.released;
      maintenanceOn = outcome.on;
    } catch (releaseErr) {
      // Never fails the approval: the row change is the durable half and the
      // allowlist can be edited from the roster. Reported, so it isn't silent.
      console.error('Failed to release from maintenance:', releaseErr);
    }

    if (athlete.approved) {
      // Not an error, and now not a no-op either — this is the path a
      // blocked-but-already-approved member takes out of the queue.
      return NextResponse.json({ message: 'Already approved', approved: true, released, maintenance: maintenanceOn });
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
            copy: (locale) => approvalCopy(locale, { name: athlete.name }),
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

    return NextResponse.json({
      success: true,
      released,
      maintenance: maintenanceOn,
      athlete: { id: athlete.id, email: athlete.email, approved: true },
    });
  } catch (error) {
    console.error('Failed to approve user:', error);
    return NextResponse.json({ error: 'Failed to approve user' }, { status: 500 });
  }
}
