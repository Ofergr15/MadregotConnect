// @vitest-environment happy-dom
/**
 * The run page's charts and split lists against the REAL /stream and /details payloads for a
 * teammate viewing a run whose pace the runner hid (t: [], pace all null, per-km/lap pace and
 * duration null) — and for the same run with nothing hidden. Before the client fix, the "by
 * time" toggle stayed on offer and every HR/cadence/elevation line became an `MNaN…` path.
 * Synthetic data only. Set COMPAT_OUT to also write the payloads and rendered HTML.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
const OUT = process.env.COMPAT_OUT;
const ACT = '00000000-0000-4000-8000-0000000000c3';
const h = vi.hoisted(() => ({ caller: { athleteId: 'teammate', isStaff: false, isSuperUser: false } as Record<string, unknown>, feed: { data: [] as unknown[], error: null as unknown }, hrOk: true }));
vi.mock('next-intl', () => ({ useTranslations: () => Object.assign((k: string) => k, { rich: (k: string) => k }), useLocale: () => 'he' }));
vi.mock('@/lib/auth/self-or-staff', async (o) => ({ ...(await o<typeof import('@/lib/auth/self-or-staff')>()), resolveVerifiedCaller: vi.fn(async () => ({ denied: null, caller: h.caller })) }));
vi.mock('@/lib/auth/pending-athletes', () => ({ isPendingAthlete: vi.fn(async () => false), seesPending: () => false }));
vi.mock('@/lib/athletes/hr-trace-privacy', async (o) => ({ ...(await o<typeof import('@/lib/athletes/hr-trace-privacy')>()), readHrTracePublic: vi.fn(async () => h.hrOk) }));
// 6 km synthetic run: 3:00 warm-up-ish variation, elevation wave, cadence.
const N = 1800; const t = Array.from({ length: N }, (_, i) => i);
const v = t.map((s) => 3.2 + 0.4 * Math.sin(s / 120));
let acc = 0; const d = v.map((x) => (acc += x));
vi.mock('@/lib/garmin/stream-store', () => ({ loadActivityStream: vi.fn(async () => ({
  series: { t, d, v, hr: t.map((s) => 140 + Math.round(15 * Math.sin(s / 200))), cad: t.map(() => 178), elev: t.map((s) => 20 + 8 * Math.sin(s / 300)) },
  laps: [{ distance: 1000, duration: 300, averagePace: 300, averageHR: 150 }, { distance: 400, duration: 80, averagePace: 200, averageHR: 170 }, { distance: 1000, duration: 310, averagePace: 310, averageHR: 148 }],
})) }));
vi.mock('@/lib/activities/quality-name', () => ({ qualityNames: vi.fn(async () => new Map()) }));
vi.mock('@/lib/plans/match-athlete-activities', () => ({ groupNumberForAthlete: vi.fn(async () => 1) }));
const ROW = { id: ACT, athlete_id: 'owner', source: 'strava', activity_name: 'Synthetic', activity_type: 'running', start_time: '2026-11-19T06:00:00+00:00',
  distance: 5800, duration: 1800, moving_duration: 1790, average_pace: 310, average_hr: 147, max_hr: 168, calories: 400, gps_points: [], laps: [], has_polyline: false,
  splits: [{ distance: 1000, duration: 305, averagePace: 305, averageHR: 145 }, { distance: 1000, duration: 300, averagePace: 300, averageHR: 150 }, { distance: 800, duration: 250, averagePace: 312, averageHR: 149 }],
  athletes: { name: 'Owner', avatar_url: null }, shoes: null, elapsed_duration: 1800 };
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: (table: string) => { const b: any = {
  select: () => b, eq: () => b, or: () => b, gte: () => b, lte: () => b, in: () => b, limit: () => b, order: () => b,
  maybeSingle: async () => ({ data: table === 'athlete_activities' ? ROW : null, error: null }),
  then: (ok: any, bad: any) => Promise.resolve(table === 'feed_items' ? h.feed : { data: [], error: null }).then(ok, bad) }; return b; } }) }));

async function call(route: 'stream' | 'details') {
  const mod = route === 'stream' ? await import('@/app/api/activities/stream/route') : await import('@/app/api/activities/details/route');
  return (await mod.GET(new Request(`http://x/api/activities/${route}?activityId=${ACT}`))).json();
}
const cases: Record<string, () => void> = {
  'teammate-unhidden': () => { h.caller = { athleteId: 'teammate', isStaff: false, isSuperUser: false }; h.feed = { data: [], error: null }; },
  'teammate-hidden-calories-only': () => { h.caller = { athleteId: 'teammate', isStaff: false, isSuperUser: false }; h.feed = { data: [{ payload: { hiddenFields: ['calories'] } }], error: null }; },
  'owner-hidden-all': () => { h.caller = { athleteId: 'owner', isStaff: false, isSuperUser: false }; h.feed = { data: [{ payload: { hiddenFields: ['pace', 'heart_rate', 'calories'] } }], error: null }; },
  'teammate-hidden-pace': () => { h.caller = { athleteId: 'teammate', isStaff: false, isSuperUser: false }; h.feed = { data: [{ payload: { hiddenFields: ['pace'] } }], error: null }; },
};
const got: Record<string, { stream: any; details: any }> = {};
beforeAll(async () => { for (const [k, set] of Object.entries(cases)) { set(); got[k] = { stream: await call('stream'), details: await call('details') }; } if (OUT) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(`${OUT}/responses.json`, JSON.stringify(got, null, 1)); } });

describe('payloads', () => {
  it('hidden pace: no time axis and no pace, but distance, HR, cadence and elevation series stay full length; totals unchanged', () => {
    const s = got['teammate-hidden-pace'].stream.stream; const a = got['teammate-hidden-pace'].details.activity;
    expect(s.t).toEqual([]); expect(s.pace.every((p: unknown) => p == null)).toBe(true);
    for (const k of ['hr', 'cad', 'elev']) expect(s[k].length).toBe(s.d.length);
    expect(a).toMatchObject({ distance: 5800, duration: 1800, moving_duration: 1790, elapsed_duration: 1800, average_hr: 147 });
  });
  it('nothing hidden: time axis and pace present', () => {
    const s = got['teammate-unhidden'].stream.stream;
    expect(s.t.length).toBe(s.d.length); expect(s.pace.some((p: unknown) => p != null)).toBe(true);
  });
});

describe('render with real components', () => {
  it('hidden pace: RunCharts / KmSplitsList / KmSplits / Laps / PaceHrScatter render, by-distance and by-time', async () => {
    const React = await import('react'); const { createRoot } = await import('react-dom/client'); const { act } = await import('react');
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const { RunCharts } = await import('@/components/activity/RunCharts');
    const { KmSplitsList, PaceHrScatter } = await import('@/components/activity/RunAnalysis');
    const { KmSplits, Laps } = await import('@/components/activity/RunSections');
    const errors: string[] = []; const oe = console.error; console.error = (...a: unknown[]) => { errors.push(a.map(String).join(' ').slice(0, 300)); };
    const snaps: Record<string, string> = {};
    for (const key of ['teammate-unhidden', 'teammate-hidden-pace']) {
      const s = got[key].stream; const det = got[key].details;
      const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
      await act(async () => { root.render(React.createElement('div', { dir: 'rtl', style: { width: '390px' } },
        React.createElement(RunCharts, { view: s.stream, splits: det.splits, avgPace: det.activity.average_pace, avgHr: det.activity.average_hr, elevationGain: 40, maxHr: s.maxHr }),
        React.createElement(KmSplitsList, { splits: s.kmSplits, maxHr: s.maxHr }),
        React.createElement(KmSplits, { streamKm: null, splits: det.splits, maxHr: s.maxHr }),
        React.createElement(Laps, { laps: s.laps }),
        React.createElement(PaceHrScatter, { view: s.stream, bands: [] }))); });
      snaps[`${key}-byDistance`] = host.innerHTML;
      const btn = [...host.querySelectorAll('button')].find((b) => b.textContent === 'byTime');
      snaps[`${key}-hasTimeToggle`] = String(!!btn);
      if (btn) { await act(async () => { (btn as HTMLButtonElement).click(); }); snaps[`${key}-byTime`] = host.innerHTML; }
      await act(async () => root.unmount()); host.remove();
    }
    console.error = oe;
    if (OUT) { fs.writeFileSync(`${OUT}/render-errors.json`, JSON.stringify(errors, null, 1)); for (const [k, html] of Object.entries(snaps)) fs.writeFileSync(`${OUT}/${k}.html`, html); }
    expect(errors).toEqual([]);
    for (const html of Object.values(snaps)) expect(html).not.toContain('NaN');
    // Hidden pace: distance only, a note instead of an empty pace chart, no "fastest", neutral bars.
    expect(snaps['teammate-hidden-pace-hasTimeToggle']).toBe('false');
    expect(snaps['teammate-hidden-pace-byDistance']).toContain('paceNotShown');
    expect(snaps['teammate-hidden-pace-byDistance']).not.toContain('fastest');
    expect(snaps['teammate-hidden-pace-byDistance']).toContain('#E5E7EB');
    expect(snaps['teammate-hidden-pace-byDistance']).toContain('heartRate');
    expect(snaps['teammate-hidden-pace-byDistance']).toContain('cadence');
    expect(snaps['teammate-hidden-pace-byDistance']).toContain('elevation');
    // Nothing hidden: unchanged — the toggle is offered, the pace chart drawn, no note.
    expect(snaps['teammate-unhidden-hasTimeToggle']).toBe('true');
    expect(snaps['teammate-unhidden-byDistance']).not.toContain('paceNotShown');
    expect(snaps['teammate-unhidden-byTime']).toContain('heartRate');
  });
});
