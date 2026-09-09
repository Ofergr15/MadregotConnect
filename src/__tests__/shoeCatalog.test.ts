import { describe, it, expect } from 'vitest';
import {
  EU_SHOE_SIZES,
  SHOE_CATALOG,
  SHOE_CATALOG_ENTRIES,
  catalogShoeName,
  findCatalogShoe,
} from '@/lib/shoe-catalog';

/**
 * The two halves of "which shoes exist": the size an athlete wears, and the model
 * they run in.
 *
 * Both were free-text fields that got replaced by picklists, and a picklist has a
 * failure mode plain text does not — it can leave somebody with no way to answer.
 * That is exactly what was reported on 2026-09-08 ("no shoe sizes above 46"), so
 * the bounds are asserted here rather than left to a component to hold.
 */

describe('EU_SHOE_SIZES', () => {
  it('runs from 36 to 50', () => {
    expect(EU_SHOE_SIZES[0]).toBe('36');
    expect(EU_SHOE_SIZES[EU_SHOE_SIZES.length - 1]).toBe('50');
  });

  // The report, as a test. 46 was the old ceiling.
  it('goes above 46', () => {
    expect(EU_SHOE_SIZES).toContain('46.5');
    expect(EU_SHOE_SIZES).toContain('47');
    expect(EU_SHOE_SIZES).toContain('48');
    expect(EU_SHOE_SIZES).toContain('49.5');
  });

  it('steps by half sizes with no gaps and no duplicates', () => {
    const nums = EU_SHOE_SIZES.map(Number);
    expect(new Set(EU_SHOE_SIZES).size).toBe(EU_SHOE_SIZES.length);
    for (let i = 1; i < nums.length; i++) expect(nums[i] - nums[i - 1]).toBeCloseTo(0.5, 10);
  });

  // Stored as-is on the athlete row, and rendered as-is in the picker: "42",
  // never "42.0". Both would round-trip, but only one of them looks like a size.
  it('writes whole sizes without a trailing .0', () => {
    expect(EU_SHOE_SIZES).toContain('42');
    expect(EU_SHOE_SIZES.some((s) => s.endsWith('.0'))).toBe(false);
  });
});

describe('SHOE_CATALOG', () => {
  it('lists every model exactly once', () => {
    const models = SHOE_CATALOG_ENTRIES.map((e) => e.model);
    expect(new Set(models).size).toBe(models.length);
    expect(models).toHaveLength(8);
  });

  it('has no empty group', () => {
    for (const group of SHOE_CATALOG) expect(group.models.length).toBeGreaterThan(0);
  });

  it('gives every group a distinct id', () => {
    const ids = SHOE_CATALOG.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('describes every model with a purpose and a usable limit', () => {
    for (const e of SHOE_CATALOG_ENTRIES) {
      expect(e.purpose.trim().length).toBeGreaterThan(0);
      expect(e.suggestedLimitKm).toBeGreaterThan(0);
    }
  });

  // The one substantive claim the suggested limits make. If a carbon racing shoe
  // is ever given a longer life than a daily trainer, the prefill has stopped
  // meaning anything.
  it('never suggests a longer life for a carbon racer than for a daily trainer', () => {
    const carbonMax = Math.max(
      ...SHOE_CATALOG_ENTRIES.filter((e) => e.carbon).map((e) => e.suggestedLimitKm),
    );
    const plainMin = Math.min(
      ...SHOE_CATALOG_ENTRIES.filter((e) => !e.carbon).map((e) => e.suggestedLimitKm),
    );
    expect(carbonMax).toBeLessThan(plainMin);
  });

  it('covers both surfaces', () => {
    expect(SHOE_CATALOG_ENTRIES.some((e) => e.surface === 'road')).toBe(true);
    expect(SHOE_CATALOG_ENTRIES.some((e) => e.surface === 'trail')).toBe(true);
  });
});

describe('catalogShoeName', () => {
  it('stores the brand with the model, so a row reads on its own', () => {
    expect(catalogShoeName(SHOE_CATALOG_ENTRIES[0])).toMatch(/^HOKA /);
  });
});

describe('findCatalogShoe', () => {
  it('recognises the name it stores', () => {
    for (const e of SHOE_CATALOG_ENTRIES) {
      expect(findCatalogShoe(catalogShoeName(e))?.model).toBe(e.model);
    }
  });

  // Shoes added before this list existed are hand-typed. They should light up as
  // the model they are, not look like something the app has never heard of.
  it('recognises a hand-typed name without the brand, in any case or spacing', () => {
    expect(findCatalogShoe('Mach 7')?.model).toBe('Mach 7');
    expect(findCatalogShoe('mach 7')?.model).toBe('Mach 7');
    expect(findCatalogShoe('  HOKA   Mach 7 ')?.model).toBe('Mach 7');
    expect(findCatalogShoe('BONDI 9')?.model).toBe('Bondi 9');
  });

  // Forgiving about spelling, strict about identity: a different shoe must not
  // inherit this one's suggested limit.
  it('does not match a neighbouring model or a partial name', () => {
    expect(findCatalogShoe('Mach 6')).toBeNull();
    expect(findCatalogShoe('Mach')).toBeNull();
    expect(findCatalogShoe('Clifton')).toBeNull();
    expect(findCatalogShoe('Nike Pegasus 41')).toBeNull();
  });

  it('has no opinion about an empty or missing name', () => {
    expect(findCatalogShoe('')).toBeNull();
    expect(findCatalogShoe('   ')).toBeNull();
    expect(findCatalogShoe(null)).toBeNull();
    expect(findCatalogShoe(undefined)).toBeNull();
  });
});
