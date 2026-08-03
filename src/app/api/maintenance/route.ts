import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { canApprove } from '@/lib/constants';

export const dynamic = 'force-dynamic';

async function getSettings() {
  const supabase = createServerClient();
  const { data } = await supabase.from('app_settings').select('key, value').in('key', ['maintenance_mode', 'maintenance_allow']);
  const map = Object.fromEntries((data || []).map((r: { key: string; value: string }) => [r.key, r.value]));
  const on = map['maintenance_mode'] === 'on';
  const allow = (map['maintenance_allow'] || '')
    .split(',').map((e: string) => e.toLowerCase().trim()).filter(Boolean);
  return { on, allow };
}

// GET /api/maintenance?email=…  → { maintenance, allowed, allowlist }
// allowed = the viewer's email is on the SAVED allowlist. (Approvers are NOT
// auto-exempt anymore — the allowlist controls everyone. The actor who turns
// maintenance ON is auto-added, so admins can't accidentally lock themselves out.)
export async function GET(request: Request) {
  try {
    const email = (new URL(request.url).searchParams.get('email') || '').toLowerCase().trim();
    const { on, allow } = await getSettings();
    const allowed = !!email && allow.includes(email);
    return NextResponse.json({ maintenance: on, allowed, allowlist: allow });
  } catch {
    return NextResponse.json({ maintenance: false, allowed: true, allowlist: [] });
  }
}

// PUT /api/maintenance  — toggle and/or update the allowlist (approver only)
//   { actorEmail, on?: boolean, allowlist?: string[] }
export async function PUT(request: Request) {
  try {
    const { on, allowlist, actorEmail } = await request.json();
    if (!canApprove(actorEmail)) {
      return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
    }
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
      if (on) {
        const actor = String(actorEmail).toLowerCase().trim();
        const base = nextAllow ?? (await getSettings()).allow;
        if (actor && !base.includes(actor)) nextAllow = [...base, actor];
      }
    }
    if (nextAllow) rows.push({ key: 'maintenance_allow', value: nextAllow.join(','), updated_at: now });

    if (rows.length > 0) {
      const { error } = await supabase.from('app_settings').upsert(rows, { onConflict: 'key' });
      if (error) throw error;
    }
    const { on: nowOn, allow } = await getSettings();
    return NextResponse.json({ maintenance: nowOn, allowlist: allow });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
