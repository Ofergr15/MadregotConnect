import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLOTHING_SIZES, KIT_SIZE_FIELDS, SOCK_SIZES, kitSizeSetupInput } from '@/lib/kit-sizes';

/**
 * The kit-size lists exist twice by necessity: once in TypeScript, and once as a
 * CHECK constraint in SQL that no import can reach. A value the form offers and the
 * CHECK rejects is not a validation message — it is a 500 from the database on save.
 * So this reads the migrations back and compares them.
 */

const root = join(__dirname, '..', '..');
const sql = readFileSync(join(root, 'supabase/migrations/100_athlete_kit_sizes.sql'), 'utf8');
const sql061 = readFileSync(join(root, 'supabase/migrations/061_athlete_shirt_size.sql'), 'utf8');

/** The values inside `CHECK (<column> IN (…))` for one column. */
function checkValues(source: string, column: string): string[] {
  const m = source.match(new RegExp(`CHECK\\s*\\(${column} IN \\(([^)]*)\\)`));
  expect(m, `no CHECK found for ${column}`).toBeTruthy();
  return m![1].split(',').map(v => v.trim().replace(/^'|'$/g, ''));
}

describe('kit sizes', () => {
  it('covers the four garments the club orders', () => {
    expect(KIT_SIZE_FIELDS.map(k => k.field)).toEqual(['shirtSize', 'pantsSize', 'tightsSize', 'socksSize']);
  });

  it('maps every field to a snake_case column', () => {
    for (const { field, column } of KIT_SIZE_FIELDS) {
      // camelCase → snake_case, which is what the API's read/write helpers assume.
      expect(column).toBe(field.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`));
    }
  });

  it('matches the CHECK constraints in migration 100', () => {
    for (const column of ['pants_size', 'tights_size']) {
      expect(checkValues(sql, column)).toEqual([...CLOTHING_SIZES]);
    }
    expect(checkValues(sql, 'socks_size')).toEqual([...SOCK_SIZES]);
  });

  it('matches the shirt CHECK from migration 061, which predates this file', () => {
    // shirt_size is not in 100 — it landed in 061 and its constraint is what the
    // shared CLOTHING_SIZES list has to keep agreeing with.
    expect(checkValues(sql061, 'shirt_size')).toEqual([...CLOTHING_SIZES]);
  });

  it('sizes socks off the shoe, not off the body', () => {
    // The mistake a copy-pasted fourth question makes. Guarded because the API
    // validates each field against its OWN list, and a socks row offering 'M' would
    // be accepted by the route and rejected by the database.
    expect(SOCK_SIZES).not.toContain('M');
    const socks = KIT_SIZE_FIELDS.find(k => k.field === 'socksSize')!;
    expect(socks.options).not.toBe(CLOTHING_SIZES);
  });

  it('reads a row that has no kit columns at all as unanswered', () => {
    // The window between deploying this and migration 100 being pasted in: the
    // columns are absent, so every read is undefined and must degrade to null
    // rather than to the string "undefined" or a throw.
    expect(kitSizeSetupInput({})).toEqual({ pantsSize: null, tightsSize: null, socksSize: null });
    expect(kitSizeSetupInput({ pants_size: 'L' })).toEqual({ pantsSize: 'L', tightsSize: null, socksSize: null });
    // Postgres nulls arrive as null, and '' should never count as an answer.
    expect(kitSizeSetupInput({ pants_size: null, tights_size: '' }).tightsSize).toBeNull();
  });
});
