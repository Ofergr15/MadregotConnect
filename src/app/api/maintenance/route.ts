import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';
import { clearMaintenanceCache, maintenanceBlocks, readMaintenance } from '@/lib/maintenance';

export const dynamic = 'force-dynamic';

/** Uncached — the writer below must see what it just wrote. */
async function getSettings() {
  const supabase = createServerClient();
  const { data } = await supabase.from('app_settings').select('key, value').in('key', ['maintenance_mode', 'maintenance_allow']);
  const map = Object.fromEntries((data || []).map((r: { key: string; value: string }) => [r.key, r.value]));
  const on = map['maintenance_mode'] === 'on';
  const allow = (map['maintenance_allow'] || '')
    .split(',').map((e: string) => e.toLowerCase().trim()).filter(Boolean);
  return { on, allow };
}

// GET /api/maintenance  → { maintenance, allowed, allowlist? }
//
// `allowed` is about the VERIFIED session, never about a `?email=` the caller
// supplies. That parameter was the whole bypass: the addresses on the allowlist
// are approver addresses, which ship in the client bundle, so anybody could ask
// the endpoint whether an admin is allowed in and act on the yes. It is now
// ignored — and the screen no longer has an address to send, because it reads the
// answer for whoever holds the token.
//
// No session means blocked, not allowed: the allowlist cannot recognise somebody
// it knows nothing about. (The gate never covers the public paths, so a visitor
// who has not signed in yet is not affected — see PUBLIC_PATHS.)
//
// `allowlist` goes only to an approver. It is the list of who can still get in
// during a window, which is nobody else's business.
//
// `identified` and `superUser` are here so the screen stops working them out for
// itself — it used to read localStorage and run isSuperUser() in the browser, both
// of which the viewer can write.
export async function GET(request: Request) {
  try {
    const state = await readMaintenance();
    const auth = await requireSession(request);
    if (!auth.ok) {
      return NextResponse.json({
        maintenance: state.on,
        allowed: !state.on,
        identified: false,
        superUser: false,
      });
    }
    const allowed = !maintenanceBlocks(
      { email: auth.user.email, athleteEmail: auth.user.athleteEmail, athleteId: auth.user.athleteId },
      state,
    );
    return NextResponse.json({
      maintenance: state.on,
      allowed,
      identified: true,
      superUser: auth.user.isSuperUser,
      ...(auth.user.canApprove ? { allowlist: state.allow } : {}),
    });
  } catch {
    // Fails open, the same way readMaintenance does and for the same reason: a
    // read that did not answer is not evidence that the club is closed.
    return NextResponse.json({ maintenance: false, allowed: true, identified: false, superUser: false });
  }
}

// PUT /api/maintenance  — toggle and/or update the allowlist (approver only)
//   Bearer <supabase jwt> + { on?: boolean, allowlist?: string[] }
//
// The actor is the VERIFIED session email, never a value from the body. It used
// to be `body.actorEmail`, which meant anyone could lock the whole club out of
// the app by posting an approver's address — and APPROVER_EMAILS ships in the
// client bundle, so those addresses are public.
export async function PUT(request: Request) {
  try {
    const auth = await requireSession(request);
    if (!auth.ok) return authError(auth);
    // `auth.user.canApprove`, NOT canApprove(auth.user.email): the second is a
    // check against an email LITERAL, and login is Strava-only, so the JWT email
    // is always the synthetic `strava_<id>@…local`. That check could never pass
    // for anybody — the toggle 403'd for every admin in the club, which is how
    // maintenance mode got stuck on with no way to turn it off from the app. The
    // session flag reads the row's `is_approver` and handles exactly this.
    if (!auth.user.canApprove) {
      return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
    }
    const { on, allowlist } = await request.json();
    const supabase = createServerClient();
    const now = new Date().toISOString();
    const rows: Array<{ key: string; value: string; updated_at: string }> = [];

    // Resolve the allowlist we'll end up with (explicit update wins, else current).
    let nextAllow: string[] | null = null;
    if (Array.isArray(allowlist)) {
      nextAllow = [...new Set(allowlist.map((e: string) => String(e).toLowerCase().trim()).filter(Boolean))];
    }

    if (typeof on === 'boolean') {
      rows.push({ key: 'maintenance_mode', value: on ? 'on' : 'off', updated_at: now });
      // SAFEGUARD: turning maintenance ON auto-adds the actor to the allowlist so
      // the admin who flips it can never lock themselves out.
      //
      // Adds their athlete ID, not their address. The address it used to add was
      // the JWT one — synthetic for a Strava login, which is everybody — so the
      // safeguard wrote an entry that could never match the person it was meant
      // to protect. Their real address goes in too when the row has one, so the
      // list stays readable to a human editing it.
      if (on) {
        const handles = [auth.user.athleteId, auth.user.athleteEmail, auth.user.email]
          .map((h) => String(h || '').toLowerCase().trim())
          .filter((h) => h && !h.endsWith('.local'));
        const base = nextAllow ?? (await getSettings()).allow;
        const missing = handles.filter((h) => !base.includes(h));
        if (missing.length > 0) nextAllow = [...base, ...missing];
      }
    }
    if (nextAllow) rows.push({ key: 'maintenance_allow', value: nextAllow.join(','), updated_at: now });

    if (rows.length > 0) {
      const { error } = await supabase.from('app_settings').upsert(rows, { onConflict: 'key' });
      if (error) throw error;
    }
    // The API gate caches its answer for a few seconds. Drop it here so the
    // window starts (or ends) on the tap rather than up to a TTL later — this
    // instance at least; others expire on their own.
    clearMaintenanceCache();
    const { on: nowOn, allow } = await getSettings();
    return NextResponse.json({ maintenance: nowOn, allowlist: allow });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
