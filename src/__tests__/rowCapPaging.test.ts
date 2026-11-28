import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { fetchAllRows, PAGE_SIZE } from '@/lib/supabase/paginate';

/**
 * Multi-athlete reads that can pass PostgREST's 1000-row cap must page (the
 * fetchWeeklyVolume lesson). These four were found unpaged in the 2026-11 sweep.
 */
const PAGED: Array<[file: string, marker: string]> = [
  ['src/lib/challenges/engine.ts', "fetchAllRows<ActivityForMetric>"],
  ['src/lib/weekly-snapshots.ts', 'const activities = await fetchAllRows'],
  ['src/app/api/workout-feedback/route.ts', 'fetchAllRows<FeedbackActivityDbRow>((from, to) => supabase'],
  ['src/app/api/admin/onboarding-funnel/route.ts', "const pushes = (await readAll"],
];

describe('club-wide reads page past 1000 rows', () => {
  it.each(PAGED)('%s pages its read', (file, marker) => {
    const src = readFileSync(file, 'utf8');
    expect(src).toContain(marker);
    // The paged query carries a range and a total order ending in a unique key.
    const at = src.indexOf(marker);
    const body = src.slice(at, at + 900);
    expect(body).toMatch(/\.range\(from, to\)/);
    expect(body).toMatch(/\.order\('id'\)/);
  });

  it('a 2,500-row result comes back whole, not cut at 1000', async () => {
    const total = 2500;
    const rows = await fetchAllRows<{ id: number }>(async (from, to) => ({
      data: Array.from({ length: Math.max(0, Math.min(to, total - 1) - from + 1) }, (_, i) => ({ id: from + i })),
      error: null,
    }));
    expect(PAGE_SIZE).toBe(1000);
    expect(rows).toHaveLength(total);
    expect(new Set(rows.map((r) => r.id)).size).toBe(total);
  });
});
