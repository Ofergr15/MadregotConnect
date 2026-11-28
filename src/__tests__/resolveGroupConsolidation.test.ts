import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GROUP_HEX, resolveGroup } from '@/lib/utils';
import { packOf as clubPackOf } from '@/lib/club-numbers/compute';
import { LANE_HEX } from '@/components/attendance/model';
import { PACK_COLORS } from '@/components/coach-space/Insights';

// The hand-rolled matcher club-numbers used to carry, kept here to prove equivalence.
function legacyClubPack(name: string | null): string {
  const n = (name || '').toLowerCase();
  if (n.includes('group a') || n.includes('group 1') || n.includes('sub 2:30')) return 'דבוקה 1';
  if (n.includes('group b') || n.includes('group 2') || n.includes('sub 2:35')) return 'דבוקה 2';
  if (n.includes('group c') || n.includes('group 3') || n.includes('sub 2:45')) return 'דבוקה 3';
  return 'בלי דבוקה';
}

describe('call sites routed through resolveGroup', () => {
  const names = ['Group 1', 'Group A - SUB 2:30', 'group b', 'SUB 2:35', 'Group 3', 'sub 2:45', 'Group C', 'Sprinters', '', null, '  Group 2  '];

  it('club-numbers packOf matches the old inline matcher', () => {
    for (const n of names) {
      expect(clubPackOf({ isAcademy: false, bandNumber: null, groupName: n } as never)).toBe(legacyClubPack(n));
    }
    expect(clubPackOf({ isAcademy: true, bandNumber: 6, groupName: 'Group 1' } as never)).toBe('דבוקה 6');
  });

  it('attendance lane colours are the group hexes (unchanged values)', () => {
    expect(LANE_HEX).toEqual({ 1: '#16a34a', 2: '#159AFF', 3: '#FF5315', academy: '#8E7CFF' });
    expect(LANE_HEX[1]).toBe(resolveGroup('Group 1').hex);
  });

  it('coach insights packs A/B/C share group 1/2/3 colours', () => {
    expect(PACK_COLORS).toEqual({ A: GROUP_HEX[0], B: GROUP_HEX[1], C: GROUP_HEX[2] });
    expect(PACK_COLORS.A).toBe(resolveGroup('Group A').hex);
  });
});

// Ratchet: no new hardcoded per-group colour tables or name matchers outside utils.ts.
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (e === '__tests__' || e === 'node_modules') continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

describe('ratchet: group colour/name derivation lives in resolveGroup', () => {
  const root = join(__dirname, '..');
  const files = ['components', 'app', 'lib'].flatMap((d) => walk(join(root, d)))
    .filter((f) => !f.endsWith(join('lib', 'utils.ts')));
  const HEX = `['"]#[0-9a-fA-F]{3,8}['"]`;
  const colourMap = new RegExp(`\\{\\s*['"]?(A|1)['"]?\\s*:\\s*${HEX}\\s*,\\s*['"]?(B|2)['"]?\\s*:\\s*${HEX}`);
  const nameMatcher = /includes\(\s*['"](group [a-c1-3]|sub 2:3[05]|sub 2:45)['"]\s*\)/i;

  it('no hardcoded group-colour map keyed A/B/C or 1/2/3', () => {
    expect(files.filter((f) => colourMap.test(readFileSync(f, 'utf8')))).toEqual([]);
  });
  it('no copied three-hex group palette array', () => {
    const palette = new RegExp(`\\[\\s*'${GROUP_HEX[0]}',\\s*'${GROUP_HEX[1]}',\\s*'${GROUP_HEX[2]}'\\s*\\]`, 'i');
    expect(files.filter((f) => palette.test(readFileSync(f, 'utf8')))).toEqual([]);
  });
  it('no inline group-name matcher', () => {
    expect(files.filter((f) => nameMatcher.test(readFileSync(f, 'utf8')))).toEqual([]);
  });
});
