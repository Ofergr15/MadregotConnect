import { after, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';
import { membershipFor } from '@/lib/auth/membership';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET /api/auth/me — "what may the person holding this session see?"
//
// This is the nav's bootstrap call on every page load, and it used to answer it
// for whatever address arrived in x-user-email: sending a coach's email got you
// `role: 'admin'` and the full staff nav, and it doubled as an oracle for which
// addresses are members. requireSession does the same athletes-then-coaches
// lookup, from the JWT instead.
export async function GET(request: Request) {
  try {
    const auth = await requireSession(request);
    if (!auth.ok) {
      // A verified account with no membership row is an answer, not a failure —
      // it's the 'viewer' this route already fell through to. Only a missing or
      // invalid token is a real 401.
      if (auth.status === 403) return NextResponse.json({ role: 'viewer', membership: 'none' });
      return authError(auth);
    }

    // Staff that live only in `coaches` (legacy) have no athletes row to read
    // is_academy from, and nothing to stamp last_seen_at on.
    // `isSuper` rides along because the nav's view-as control was deciding it
    // client-side off whatever address localStorage happened to hold — a
    // synthetic Strava address answers "not the super user" and the control
    // disappears.
    //
    // Deriving it from the verified JWT email fixed the *forgeable* half but not
    // the synthetic-address half: the address is genuinely not SUPER_USER_EMAIL,
    // so the honest answer was still "no". Migration 084 moves the truth onto the
    // athlete row, and requireSession resolves row-flag-OR-literal; both flags
    // now just ride out from there. `canApprove` joins it so the Settings and
    // Registrations screens can stop importing the allowlist into the browser.
    // `=== true` rather than a bare read: JSON.stringify drops an undefined
    // value entirely, so a caller that resolved a session without these fields
    // would silently omit the keys instead of answering false.
    const isSuper = auth.user.isSuperUser === true;
    const canApproveHere = auth.user.canApprove === true;
    // הגרעין rides out the same way, and for the same reason `is_academy` does
    // below: it is a FLAG, not a role, so the client cannot derive the 🌰 badge
    // from `role` alone (migration 091). Free here — requireSession resolved it.
    const isCore = auth.user.isCoreRunner === true;
    // Every role held (migration 127) — what the top bar's view switcher offers.
    // The primary `role` stays beside it for every reader that knows only one.
    const roles = auth.user.roles?.length ? auth.user.roles : [auth.user.role || 'runner'];

    // ── May this person be inside the app at all? ───────────────────────────
    //
    // `membership` is the shell's gate, and it is deliberately a THIRD answer
    // rather than something the client derives from `role`: a revoked or
    // not-yet-approved member keeps their role ('runner'), so role alone reads
    // as "let them in". The values, and what each one means, are documented on
    // membershipFor() in src/lib/auth/membership.ts — the one place that decides.
    // Only 'active' may see club content. See AccessBlocked + the (app) layout:
    // before this existed, a revoked account got the whole signed-in shell and
    // every card inside it failed on its own with a raw English 403.
    if (!auth.user.athleteId) {
      return NextResponse.json({ role: auth.user.role || 'coach', roles, membership: 'active', isSuper, canApprove: canApproveHere, isCoreRunner: isCore, qualitySession: isSuper });
    }

    const supabase = createServerClient();
    const athleteId = auth.user.athleteId;

    // ONE read for everything requireSession's select doesn't carry. This is the
    // request that gates the whole app, and every sequential query in it costs a
    // full function↔DB round trip (~225 ms from iad1 to the Tokyo DB) before the
    // shell can render: it used to be four reads and two writes in a row, about
    // 1.5 s. The lab (~/.cache/madregot/lab) measured this shape at half that.
    //
    // `is_academy` rides along because academy membership is a flag, not a role:
    // an athlete with role `runner` can be in the academy (and several are), so
    // the nav can't derive their academy entry point from `role` alone. It can't
    // ride requireSession's select — that select gates every route, and a column
    // it doesn't have yet in some environment must not be able to fail it.
    //
    // `approved` is here for the same reason: it is what separates "waiting for
    // the coach" from "access was removed", and requireSession does not carry it.
    // A read that fails leaves it undefined, which membershipFor() resolves to the
    // answer that promises nothing.
    //
    // `first_seen_at` (migration 102) and `is_story_editor` (129) used to be
    // reads of their own so a column that isn't migrated yet couldn't take
    // `is_academy`/`approved` down with it. The same guarantee now costs a round
    // trip only when it's needed: if the full select errors, fall back to the
    // two columns that decide membership, and the other two read as "no".
    type Row = { is_academy?: boolean; approved?: boolean; first_seen_at?: string | null; is_story_editor?: boolean };
    const full = await supabase
      .from('athletes')
      .select('is_academy, approved, first_seen_at, is_story_editor')
      .eq('id', athleteId)
      .maybeSingle();
    let row = full.data as Row | null;
    const fullRead = !full.error;
    if (!fullRead) {
      const { data } = await supabase
        .from('athletes')
        .select('is_academy, approved')
        .eq('id', athleteId)
        .maybeSingle();
      row = data as Row | null;
    }

    const membership = membershipFor({ status: auth.user.athleteStatus, approved: row?.approved });

    // The stamps are bookkeeping nobody waits on, so they run after the response
    // is sent (Vercel keeps the function alive for them via waitUntil).
    //
    // `first_seen_at` — the one signal that means "the app actually opened for
    // them" (migration 102). An auth account is minted the moment a Strava
    // callback lands, which on iOS can happen inside another app's browser sheet
    // while the app itself never opens, so auth.users.created_at can't stand in.
    // Only stamped when the read SAW it empty: a fallback read knows nothing, and
    // a missing column means no snapshot, which is the safe direction.
    const seenAt = new Date().toISOString();
    const stampFirstSeen = fullRead && row !== null && !row.first_seen_at;
    // Viewing as somebody (lib/auth/view-as.ts) must not stamp THEIR last-seen.
    if (!auth.user.viewingAsBy) after(async () => {
      await supabase
        .from('athletes')
        .update({ last_seen_at: seenAt })
        .eq('id', athleteId);
      if (stampFirstSeen) {
        try {
          // Guarded by `is null` as well as by the read, so two tabs opening at
          // once can't move the timestamp forward and restart somebody's 15 minutes.
          await supabase
            .from('athletes')
            .update({ first_seen_at: seenAt })
            .eq('id', athleteId)
            .is('first_seen_at', null);
        } catch { /* not migrated yet — the snapshot stage stays a no-op */ }
      }
    });

    // The quality session (lib/quality-session/access.ts): no 129 yet only reads as "no".
    const qualitySession = isSuper || row?.is_story_editor === true;

    return NextResponse.json({ role: auth.user.role || 'runner', roles, membership, isAcademy: !!row?.is_academy, isSuper, canApprove: canApproveHere, isCoreRunner: isCore, qualitySession });
  } catch (error) {
    console.error('Failed to resolve user role:', error);
    return NextResponse.json({ error: 'Failed to resolve role' }, { status: 500 });
  }
}
