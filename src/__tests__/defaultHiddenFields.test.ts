import { describe, expect, it } from 'vitest';
import { cleanHiddenList, DEFAULT_HIDDEN_DEFAULT } from '@/lib/athletes/default-hidden';
import { readFileSync } from 'fs';

describe('default hidden fields (migration 193)', () => {
  it('calories are hidden by default', () => {
    expect(DEFAULT_HIDDEN_DEFAULT).toEqual(['calories']);
  });
  it('accepts only the existing hiddenFields keys, deduped and sorted', () => {
    expect(cleanHiddenList(['pace', 'calories', 'pace'])).toEqual(['calories', 'pace']);
    expect(cleanHiddenList([])).toEqual([]);
    expect(cleanHiddenList(['location'])).toBeNull();
    expect(cleanHiddenList('calories')).toBeNull();
  });
  it('the migration seeds new feed items from the list, under the same payload key masking reads', () => {
    const sql = readFileSync('supabase/migrations/193_settings_profile.sql', 'utf8');
    expect(sql).toMatch(/jsonb_build_object\('hiddenFields', to_jsonb\(hidden\)\)/);
    expect(sql).toMatch(/DEFAULT ARRAY\['calories'\]/);
    // One FK to athletes only (CLAUDE.md: a second one breaks unhinted embeds).
    expect(sql.match(/REFERENCES athletes/g)).toHaveLength(1);
  });
});
