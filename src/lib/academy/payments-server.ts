/**
 * The academy payments reads, shared by GET /api/academy/payments and GET /api/admin/finance so the
 * two screens compute the same board from the same rows (moved verbatim from the payments route).
 */
import type { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import type { BillingRecord, BillingStatus, TraineeBillingInput } from '@/lib/academy/payments';

export const BILLING_COLUMNS =
  'athlete_id, status, monthly_amount_ils, link_sent_at, activated_at, failed_at, cancelled_at, note';

export function toBilling(row: Record<string, unknown>): BillingRecord {
  return {
    athleteId: String(row.athlete_id),
    status: (row.status as BillingStatus) || 'none',
    monthlyAmountIls: row.monthly_amount_ils === null || row.monthly_amount_ils === undefined
      ? null : Number(row.monthly_amount_ils),
    linkSentAt: (row.link_sent_at as string) ?? null,
    activatedAt: (row.activated_at as string) ?? null,
    failedAt: (row.failed_at as string) ?? null,
    cancelledAt: (row.cancelled_at as string) ?? null,
    note: (row.note as string) ?? null,
  };
}

export async function loadRoster(supabase: ReturnType<typeof createServerClient>) {
  const { data: athletes } = await supabase
    .from('athletes')
    .select('id, name, academy_coach_id, academy_band_id, academy_joined_on')
    .eq('coach_id', COACH_ID)
    .eq('is_academy', true);
  const rows = (athletes || []) as Array<Record<string, unknown>>;

  const { data: bandRows } = await supabase.from('academy_bands').select('id, band_number');
  const bandNumber = new Map((bandRows || []).map(b => [String(b.id), Number(b.band_number)]));

  // Mentor names, looked up rather than joined: `academy_coach_id` points at another athletes row,
  // and a self-join through PostgREST would carry every column of it.
  const coachIds = [...new Set(rows.map(r => r.academy_coach_id).filter(Boolean).map(String))];
  const coachName = new Map<string, string>();
  if (coachIds.length) {
    const { data: coaches } = await supabase.from('athletes').select('id, name').in('id', coachIds);
    for (const c of coaches || []) coachName.set(String(c.id), String(c.name || ''));
  }

  return rows.map<Omit<TraineeBillingInput, 'billing'>>(r => ({
    athleteId: String(r.id),
    name: String(r.name || ''),
    bandNumber: r.academy_band_id ? bandNumber.get(String(r.academy_band_id)) ?? null : null,
    coachId: r.academy_coach_id ? String(r.academy_coach_id) : null,
    coachName: r.academy_coach_id ? coachName.get(String(r.academy_coach_id)) ?? null : null,
    academySince: (r.academy_joined_on as string) ?? null,
  }));
}
