import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { isCoreRunner } from '@/lib/core-runner';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

/**
 * GET /api/perks/core — "הגרעין שלי": the core perks with their status line, where to
 * redeem (a map), WhatsApp and website (migration 167), plus how many club perks there
 * are besides. Core runners only; staff may look (preview). select('*') so a DB before
 * 167 still answers, just without the new fields.
 */
export async function GET(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  const core = isCoreRunner(caller);
  if (!core && !caller.isStaff && !caller.isSuperUser) return NextResponse.json({ error: 'core only' }, { status: 403 });
  const db = createServerClient();
  const { data, error } = await db.from('club_perks').select('*').eq('active', true).order('sort_order', { ascending: true });
  if (error) return NextResponse.json({ error: 'failed' }, { status: 500 });
  const rows = (data || []) as Array<Record<string, unknown>>;
  const coreRows = rows.filter((p) => p.tier === 'core_runner');
  let name: string | null = null;
  if (caller.athleteId) {
    const { data: a } = await db.from('athletes').select('name').eq('id', caller.athleteId).maybeSingle();
    name = (a as { name?: string | null } | null)?.name ?? null;
  }
  return NextResponse.json({
    preview: !core,
    name,
    clubCount: rows.filter((p) => p.tier !== 'core_runner').length,
    perks: coreRows.map((p) => ({
      id: p.id, sponsorName: p.sponsor_name, title: p.title_he, description: p.description_he, imageUrl: p.image_url,
      discountCode: p.discount_code, redeemUrl: p.redeem_url,
      status: p.status_he ?? null, tone: p.status_tone ?? null, where: p.where_he ?? null,
      locations: Array.isArray(p.locations) ? p.locations : [], whatsapp: p.whatsapp ?? null, website: p.website ?? null,
      highlights: Array.isArray(p.highlights) ? p.highlights : [], how: typeof p.how_he === 'string' ? p.how_he.split('\n').map((l: string) => l.trim()).filter(Boolean) : [],
    })),
  });
}
