import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Source pins for the שיאים routes: who may call them, whose data they are about,
// and what they must never carry. The behaviour behind them is lib/records/board.ts
// (recordsBoard.test.ts).
const src = (p: string) => readFileSync(join(__dirname, '..', 'app', 'api', p), 'utf8');
const ROUTES = ['records/weekly/route.ts', 'records/progress/route.ts', 'records/champions/route.ts', 'records/privacy/route.ts', 'club/records/route.ts'];

describe('records routes', () => {
  it('every route resolves a verified caller (JWT), and the tab routes check records_tab', () => {
    for (const r of ROUTES) expect(src(r)).toMatch(/recordsGate|resolveVerifiedCaller/);
    for (const r of ['records/weekly/route.ts', 'records/progress/route.ts', 'records/champions/route.ts']) expect(src(r)).toMatch(/recordsGate\(request\)/);
    expect(readFileSync(join(__dirname, '..', 'lib', 'records', 'gate.ts'), 'utf8')).toMatch(/isFeatureEnabled\('records_tab'/);
  });

  it('progress and privacy are about the caller only — no athlete id from the request', () => {
    for (const r of ['records/progress/route.ts', 'records/privacy/route.ts']) {
      const s = src(r);
      expect(s).not.toMatch(/searchParams\.get\('athlete/);
      expect(s).not.toMatch(/body\.(athlete|id)/);
      expect(s).toMatch(/caller\.athleteId/);
    }
  });

  it('squad comparison only for an opted-in caller, and as a median', () => {
    const s = src('records/progress/route.ts');
    expect(s).toMatch(/if \(privacy\.squadCompare/);
    expect(s).toMatch(/squadMedianSeries/);
  });

  it('club records filter opt-out + hidden pace and never ship raw per-athlete breaks', () => {
    const s = src('club/records/route.ts');
    expect(s).toMatch(/isOnTimeTable/);
    expect(s).toMatch(/breaks: _raw/);
  });

  it('no plan accuracy anywhere in these responses', () => {
    const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const r of ROUTES) expect(code(src(r))).not.toMatch(/verdict|accuracy|gradePlanBlocks|assessWorkout/);
  });
});
