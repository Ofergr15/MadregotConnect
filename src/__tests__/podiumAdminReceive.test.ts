import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// b24: GET /api/admin/podium carries the round's receiving view, so the native admin screen needs one read, not two.
describe('admin podium GET carries receive', () => {
  const src = readFileSync('src/app/api/admin/podium/route.ts', 'utf8');
  const get = src.slice(src.indexOf('export async function GET'), src.indexOf('export async function POST'));

  it('same staff gate, before any read', () => {
    expect(get.indexOf('requireStaffCaller(request)')).toBeLessThan(get.indexOf('createServerClient()'));
  });
  it('reads receive for the chosen round, beside the orders, and a failure is null (never a 503)', () => {
    expect(get).toMatch(/round \? receiveView\(db, round\)\.catch\(\(\) => null\) : Promise\.resolve\(null\)/);
    expect(get).toMatch(/Promise\.all\(\[\s*round \? loadOrders/);
  });
  it('is additive: every field the screen already reads is still there', () => {
    for (const k of ['rounds:', 'round:', 'products, orders, core: audience', 'canCredit:', 'fillers:', 'people:', 'receive,']) expect(get).toContain(k);
  });
});
