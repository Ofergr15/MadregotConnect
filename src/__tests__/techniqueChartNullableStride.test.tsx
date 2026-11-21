// @vitest-environment happy-dom
/**
 * TechniqueChart against a technique payload whose stride is missing, null or partial (the
 * shape a server would send once it withholds stride for a run whose pace is hidden). Cadence
 * must still draw on its own; nothing about stride — line, dots, axis labels, legend, note —
 * may appear, and no 0/constant stride is invented. Numeric stride keeps the original chart.
 * Synthetic data only. Set TECHNIQUE_OUT to also write the rendered HTML.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
vi.mock('next-intl', () => ({ useTranslations: () => Object.assign((k: string, v?: Record<string, unknown>) => (v ? `${k}:${JSON.stringify(v)}` : k), { rich: (k: string) => k }) }));

type Item = { rep: number; cadence: number; stride?: number | null };
const reps = (stride: (i: number) => number | null | undefined, cad = (i: number) => 176 + i * 2): Item[] =>
  Array.from({ length: 6 }, (_, i) => { const o: Item = { rep: i + 1, cadence: cad(i) }; const s = stride(i); if (s !== undefined) o.stride = s; return o; });
const CASES: Record<string, Item[]> = {
  numeric: reps((i) => 1.3 + i * 0.03),
  'stride-null': reps(() => null),
  'stride-missing': reps(() => undefined),
  'stride-nan': reps(() => Number.NaN),
  'stride-partial': reps((i) => (i % 2 ? null : 1.4)),
  'cadence-all-nan': reps(() => 1.4, () => Number.NaN),
  'one-point': reps((i) => 1.4).slice(0, 1),
};

async function render(items: Item[]) {
  const React = await import('react'); const { createRoot } = await import('react-dom/client'); const { act } = await import('react');
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const { TechniqueChart } = await import('@/components/activity/RunAnalysis');
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  await act(async () => { root.render(React.createElement('div', { dir: 'rtl', style: { width: '390px' } }, React.createElement(TechniqueChart, { items: items as any }))); });
  const html = host.innerHTML; await act(async () => root.unmount()); host.remove(); return { html, host: (() => { const d = document.createElement('div'); d.innerHTML = html; return d; })() };
}
const out: Record<string, string> = {};
const errs: string[] = [];
const errSpy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errs.push(a.map(String).join(' ').slice(0, 200)); });
afterAll(() => errSpy.mockRestore());

describe('TechniqueChart with nullable stride', () => {
  it('numeric stride: original two-line chart, stride axis, both legends, stride note', async () => {
    const { html, host } = await render(CASES.numeric); out.numeric = html;
    expect(host.querySelectorAll('polyline').length).toBe(2);
    expect(host.querySelectorAll('circle').length).toBe(12);
    expect(html).toContain('strideM'); expect(html).toContain('techniqueSub'); expect(html).not.toContain('techniqueSubCadence');
    expect(html).toContain('techniqueNote:'); expect(html).toContain('"stride":"1.45"');
    expect(host.querySelector('[data-technique]')).toBeNull();
  });
  for (const k of ['stride-null', 'stride-missing', 'stride-nan', 'stride-partial']) {
    it(`${k}: cadence alone, every stride element hidden, no NaN/0 stride`, async () => {
      const { html, host } = await render(CASES[k]); out[k] = html;
      const lines = host.querySelectorAll('polyline'); expect(lines.length).toBe(1);
      expect(lines[0].getAttribute('stroke')).toBe('#0F766E');
      const pts = lines[0].getAttribute('points')!.split(' '); expect(pts.length).toBe(6);
      expect(pts.every((p) => p.split(',').every((n) => Number.isFinite(Number(n))))).toBe(true);
      expect(new Set(pts.map((p) => p.split(',')[1])).size).toBeGreaterThan(1);   // real, varying cadence
      expect(host.querySelectorAll('circle').length).toBe(6);
      expect(html).not.toMatch(/NaN|strideM|"stride"|techniqueNote:/);
      expect(html).not.toMatch(/>\d\.\d\d</);                                    // no stride axis labels
      expect(html).toContain('techniqueSubCadence'); expect(html).toContain('techniqueNoteCadence:{"rep0":1,"cad0":176,"rep":6,"cad":186}');
      expect(host.querySelector('[data-technique="cadence-only"]')).not.toBeNull();
    });
  }
  for (const k of ['cadence-all-nan', 'one-point']) {
    it(`${k}: nothing to draw, card omitted`, async () => {
      const { html } = await render(CASES[k]); out[k] = html; expect(html).toBe('<div dir="rtl" style="width: 390px;"></div>');
    });
  }
  it('no React errors; optional HTML dump', () => {
    expect(errs, errs.join("\n")).toEqual([]);
    if (process.env.TECHNIQUE_OUT) { fs.mkdirSync(process.env.TECHNIQUE_OUT, { recursive: true }); fs.writeFileSync(`${process.env.TECHNIQUE_OUT}/render.json`, JSON.stringify(out, null, 1)); }
  });
});
