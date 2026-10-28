import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { importProfileColumns } from '@/lib/academy/import-form';

/** What the sign-up E2E (2026-10-27/28, ~/.cache/madregot/signup-e2e/report.html) found. */
describe('sign-up E2E fixes', () => {
  it('the academy form carries every detail it has, sizes included', () => {
    expect(importProfileColumns({ birthDate: '1987-04-12', height: '166', weight: '61', shirtSize: 'S', pantsSize: 'M', tightsSize: 'S', socksSize: '39-42', shoeSize: '39' }))
      .toEqual({ birth_date: '1987-04-12', height_cm: 166, weight_kg: 61, shirt_size: 'S', pants_size: 'M', tights_size: 'S', socks_size: '39-42', shoe_size: '39' });
    expect(importProfileColumns({ socksSize: 'huge', pantsSize: 'XXXL' })).toEqual({});
  });
  it('acceptance copies the form onto the account, only where empty', () => {
    const src = readFileSync('src/lib/academy/admit-server.ts', 'utf8');
    expect(src).toMatch(/importProfileColumns\(/);
    expect(src).toMatch(/filter\(\(\[k\]\) => \(now as Record<string, unknown> \| null\)\?\.\[k\] == null\)/);
  });
  it('the club sign-up asks the name in English letters', () => {
    expect(readFileSync('src/components/join/JoinFlow.tsx', 'utf8')).toMatch(/path === 'club' && nameProblem\(`\$\{first\} \$\{last\}`\) === 'not-latin'/);
  });
  it('an imported card that was not let in is not told it was', () => {
    expect(readFileSync('src/app/api/academy/register/route.ts', 'utf8')).toMatch(/\.\.\.\(imported \? \{ letIn \} : \{\}\)/);
    expect(readFileSync('src/app/academy-register/page.tsx', 'utf8')).toMatch(/if \(data\.letIn === false\) setImported\(null\);/);
  });
});
