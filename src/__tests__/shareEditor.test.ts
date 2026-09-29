import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import { isTextPart, markLogo, partAt, placeLabels, recordHitMap, unionBox } from '@/lib/share/hit-map';
import { isolateLtrRuns } from '@/lib/feed/share-image';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const EDITOR = readFileSync(join(SRC, 'components/share/WorkoutShareEditor.tsx'), 'utf8');
const SHEET = readFileSync(join(SRC, 'components/ShareSheet.tsx'), 'utf8');
const RENDER = readFileSync(join(SRC, 'lib/feed/share-image.ts'), 'utf8');
const HE = JSON.parse(readFileSync(join(SRC, '../messages/he.json'), 'utf8'));
const EN = JSON.parse(readFileSync(join(SRC, '../messages/en.json'), 'utf8'));

/**
 * THE CARD IS THE CONTROL PANEL (feedback 2026-09-29).
 *
 * The sheet put a small preview over three tabs, and "average line" was a guess
 * away. The editor makes the card full-screen, swipes between the six views, and
 * opens a part's options when that part of the card is tapped. Where the parts
 * are is read off the drawing, so these tests pin the recorder, and the few lines
 * of the editor that carry a promise made in words.
 */

/** A context that does nothing but keep an identity transform and a font. */
function fakeCtx() {
  const noop = () => undefined;
  const ctx = {
    font: '40px sans-serif',
    direction: 'ltr' as CanvasDirection,
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    measureText: (t: string) => ({ width: t.length * 20 }),
    beginPath: noop, moveTo: noop, lineTo: noop, quadraticCurveTo: noop, bezierCurveTo: noop,
    rect: noop, roundRect: noop, arc: noop, fill: noop, stroke: noop, fillRect: noop, fillText: noop, drawImage: noop,
  };
  return ctx as unknown as CanvasRenderingContext2D & typeof ctx;
}

const MARK = { width: 100, height: 50 };
const known = { isMark: (s: unknown) => s === MARK, title: 'Morning Run', date: '29.09.26', width: 1080, height: 1920 };

describe('the hit map', () => {
  it('sorts the logo, the title line and the data into their own boxes', () => {
    const ctx = fakeCtx();
    const stop = recordHitMap(ctx, known);
    ctx.drawImage(MARK as never, 60, 900, 100, 50);
    ctx.fillText('Morning Run · 29.09.26', 500, 960);
    ctx.fillText('5.02 km', 100, 1300);
    ctx.beginPath(); ctx.moveTo(80, 1100); ctx.lineTo(1000, 1500); ctx.stroke();
    const map = stop();
    expect(map.logo).toEqual({ x0: 60, y0: 900, x1: 160, y1: 950 });
    expect(map.text!.x0).toBe(500);
    expect(map.data).toEqual({ x0: 80, y0: 1100, x1: 1000, y1: 1500 });
  });

  it('leaves out what covers most of the card: that is the background', () => {
    const ctx = fakeCtx();
    const stop = recordHitMap(ctx, known);
    ctx.fillRect(0, 0, 1080, 1920);
    ctx.drawImage({ width: 1080, height: 1920 } as never, 0, 0);
    expect(stop()).toEqual({});
  });

  it('patches only this context, and takes the patches off again', () => {
    const ctx = fakeCtx();
    const before = ctx.fillText;
    const stop = recordHitMap(ctx, known);
    expect(ctx.fillText).not.toBe(before);
    stop();
    expect(Object.prototype.hasOwnProperty.call(ctx, 'fillText')).toBe(false);
  });

  it('places right-aligned and RTL-start text to the left of its anchor', () => {
    const ctx = fakeCtx();
    ctx.direction = 'rtl';
    ctx.textAlign = 'start';
    const stop = recordHitMap(ctx, { ...known, title: 'ריצה' });
    ctx.fillText('ריצה', 1000, 500);
    expect(stop().text!.x1).toBe(1000);
  });

  it('answers a tap with the part under it, the logo and text before the data', () => {
    const map = { data: { x0: 0, y0: 800, x1: 1080, y1: 1600 }, logo: { x0: 40, y0: 900, x1: 140, y1: 950 } };
    expect(partAt(map, 90, 920)).toBe('logo');
    expect(partAt(map, 600, 1200)).toBe('data');
    expect(partAt(map, 600, 200)).toBe('background');
  });

  it('knows the title or the date inside a longer line', () => {
    expect(isTextPart('Morning Run · 29.09.26', known)).toBe(true);
    expect(isTextPart('29.09.26', { title: null, date: '29.09.26' })).toBe(true);
    expect(isTextPart('5:12 /km', known)).toBe(false);
    expect(unionBox(undefined, { x0: 1, y0: 2, x1: 3, y1: 4 })).toEqual({ x0: 1, y0: 2, x1: 3, y1: 4 });
  });

  it('still knows the title when the renderer wrapped its numbers in bidi marks', () => {
    expect(isTextPart('\u202A10×400\u202C בפארק', { title: '10×400 בפארק', date: null })).toBe(true);
  });

  it('keeps the logo\'s pieces apart, so the numbers between them stay the numbers', () => {
    const ctx = fakeCtx();
    const stop = recordHitMap(ctx, known);
    ctx.drawImage(MARK as never, 440, 1100, 200, 100); // the wordmark, above the numbers
    ctx.fillText('9.78 km', 100, 1300);
    markLogo(ctx, 520, 1450, 36, 36); // the shoe, under them
    const map = stop();
    expect(map.logoPieces).toHaveLength(2);
    expect(partAt(map, 540, 1150)).toBe('logo');
    expect(partAt(map, 538, 1468)).toBe('logo');
    expect(partAt(map, 200, 1280)).toBe('data');
  });

  it('counts a mark drawn as paths (the shoe) as the logo', () => {
    const ctx = fakeCtx();
    const stop = recordHitMap(ctx, known);
    markLogo(ctx, 300, 900, 36, 36);
    expect(stop().logo).toEqual({ x0: 300, y0: 900, x1: 336, y1: 936 });
    markLogo(ctx, 0, 0, 10, 10); // no recorder: nothing, and no throw
  });

  it('places the labels over the card apart from each other and inside it', () => {
    const card = { w: 300, h: 530 };
    // Two parts one on top of the other: the second label cannot take the first one's spot.
    const got = placeLabels([
      { key: 'text', box: { x: 20, y: 200, w: 260, h: 30 }, w: 60 },
      { key: 'logo', box: { x: 20, y: 226, w: 100, h: 40 }, w: 50 },
      { key: 'edge', box: { x: 280, y: 0, w: 20, h: 20 }, w: 60 },
    ], card, { h: 20, gap: 6, rtl: false });
    const all = Object.values(got);
    for (const a of all) {
      expect(a.x).toBeGreaterThanOrEqual(2);
      expect(a.y).toBeGreaterThanOrEqual(2);
      expect(a.x + a.w).toBeLessThanOrEqual(card.w - 2);
      for (const b of all) {
        if (a === b) continue;
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(apart).toBe(true);
      }
    }
    expect(got.text).toEqual({ x: 20, y: 177, w: 60, h: 20 }); // above, at the start
    expect(placeLabels([{ key: 't', box: { x: 20, y: 200, w: 260, h: 30 }, w: 60 }], card, { h: 20, gap: 6, rtl: true }).t!.x).toBe(220);
  });

  it('is asked for by the renderer only when the editor wants it', () => {
    expect(RENDER).toMatch(/const stopHitMap = opts\.onHitMap\s*\?\s*recordHitMap\(ctx/);
    expect(RENDER).toMatch(/if \(stopHitMap\) opts\.onHitMap!\(stopHitMap\(\)\)/);
  });
});

describe('the editor', () => {
  it('opens for the workout, for the super user only; everyone else and the week keep the sheet', () => {
    expect(SHEET).toMatch(/const editor = useIsSuperUser\(\);/);
    expect(SHEET).toMatch(/subject\.kind === 'workout' && editor\) return <WorkoutShareEditor/);
    expect(SHEET).toMatch(/return <ClassicShareSheet subject=\{subject\}/);
  });

  it('keeps the old sheet\'s rules: the drawn view, a fresh logo per view, the title', () => {
    expect(EDITOR).toMatch(/const drawn = drawnTemplate\(template, \{ routeOnly, withPhoto: bg === 'photo' && !!photo \}\)/);
    expect(EDITOR).toMatch(/setTemplate\(next\);\s*setBrand\(null\);/);
    expect(EDITOR).toMatch(/const titleText = typedTitle \?\? localizeDefaultName\(originalTitle, cardLang\)/);
    expect(EDITOR).toMatch(/onClick=\{\(\) => setTypedTitle\(null\)\}/);
    expect(EDITOR).toMatch(/const capacity = frameCapacity\(subject, drawn\)/);
  });

  it('never gains a name toggle (feedShareOwnership)', () => {
    expect(EDITOR).not.toMatch(/withName|athleteName/);
  });

  it('shows all the looks at once, without a scrolling rail', () => {
    expect(EDITOR).toMatch(/views\.map\(v => \{\s*const on = template === v\.key;/);
    expect(EDITOR).toMatch(/className=\{cn\('min-w-0 flex-1 text-center'/);
  });

  it('names every part in a row of real buttons, so no option hangs on a small tap target', () => {
    expect(EDITOR).toMatch(/const tabs: Mode\[\] = dataOk \? \['looks', 'logo', 'text', 'data', 'background'\] : \['looks', 'logo', 'text', 'background'\]/);
    // The splits chart and the route have options of their own even when their numbers
    // are fixed; hiding their tab on 'fixed' alone locked the chart options away.
    expect(EDITOR).toMatch(/const dataOk = !fixed \|\| template === 'splits' \|\| template === 'route';/);
    // A look with nothing to change there says so when tapped, rather than opening an empty tab.
    expect(EDITOR).toMatch(/if \(part === 'data' && !dataOk\) \{ setNotice\(t\(fixed!\)\); return; \}/);
    expect(EDITOR).toMatch(/role="tab"\s+aria-selected=\{mode === p\}\s+onClick=\{\(\) => openPart\(p\)\}/);
    // The labels over the card are buttons now (they were pictures of buttons), placed
    // so none lies on another.
    expect(EDITOR).toMatch(/<button\s+key=\{`label-\$\{p\}`\}\s+type="button"\s+aria-pressed=\{on\}\s+onClick=\{e => \{ e\.stopPropagation\(\); openPart\(p\); \}\}/);
    expect(EDITOR).toMatch(/const labels = placeLabels\(/);
    // They show only while editing; the card is otherwise seen as it will be shared.
    expect(EDITOR).toMatch(/\{editing && \[\.\.\.labelled, 'background' as const\]\.map/);
    expect(EDITOR).toMatch(/\{editing && labelled\.filter/);
    expect(EDITOR).toMatch(/if \(editing\) \{ setEditing\(false\); back\(\); \} else setEditing\(true\);/);
    expect(EDITOR).toMatch(/if \(next !== 'looks'\) setEditing\(true\);/);
    expect(EDITOR).not.toMatch(/showAll|showParts/);
  });

  it('always shares from the big button, and Enter in the title goes back to the looks', () => {
    expect(EDITOR).toMatch(/if \(e\.key === 'Enter'\) back\(\)/);
    expect(EDITOR).not.toMatch(/t\('done'\)/);
    expect(EDITOR).toMatch(/onClick=\{handleShare\}/);
  });

  it('can take the shoe off, on the views that draw one', () => {
    expect(EDITOR).toMatch(/supportsShoe\(drawn\) && \(/);
    expect(RENDER.match(/if \(c\.showShoe\) drawShoe\(/g)?.length).toBe(4);
    expect(RENDER.match(/\n  drawShoe\(/g)).toBeNull();
  });

  it('has every new word in both languages', () => {
    const used = [...EDITOR.matchAll(/\bt\('([a-zA-Z]+)'\)/g)].map(m => m[1]);
    for (const k of used) {
      expect(HE.shareSheet[k], k).toBeTruthy();
      expect(EN.shareSheet[k], k).toBeTruthy();
    }
  });
});

describe('a Hebrew title with numbers in it', () => {
  it('keeps "10×400" reading left to right inside the Hebrew line', () => {
    expect(isolateLtrRuns('10×400 בפארק')).toBe('\u202A10×400\u202C בפארק');
    expect(isolateLtrRuns('5 ק״מ 4:30/ק״מ')).toBe('\u202A5\u202C ק״מ \u202A4:30\u202C/ק״מ');
  });

  it('leaves a title with no Hebrew alone', () => {
    expect(isolateLtrRuns('10x400 in the park')).toBe('10x400 in the park');
  });

  it('is applied to the title before the card is drawn', () => {
    expect(RENDER).toMatch(/activityName: isolateLtrRuns\(raw\.activityName\)/);
  });
});
