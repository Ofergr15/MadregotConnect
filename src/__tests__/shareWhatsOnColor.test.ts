import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { COLOR_SWATCHES, readableColor, whiteContrast } from '@/lib/share/workout-look';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('a background colour of one\'s own (10-28)', () => {
  it('a colour the white numbers read on is kept exactly; a light one is darkened until they do', () => {
    expect(readableColor('#1525ff')).toBe('#1525ff');
    expect(readableColor('#0b0b10')).toBe('#0b0b10');
    const y = readableColor('#ffe066');
    expect(y).not.toBe('#ffe066');
    expect(whiteContrast(y)).toBeGreaterThanOrEqual(3);
    expect(whiteContrast(readableColor('#ffffff'))).toBeGreaterThanOrEqual(3);
    expect(readableColor('not a colour')).toBe('#1525FF');
  });
  it('every offered shade already reads', () => {
    for (const c of COLOR_SWATCHES) expect(whiteContrast(c)).toBeGreaterThanOrEqual(3);
  });
  it('the renderer draws it in place of the club\'s blue', () => {
    expect(read('src/lib/feed/share-image.ts')).toMatch(/if \(opts\.backgroundColor\) drawColorBackground\(ctx, opts\.backgroundColor\.hex, opts\.backgroundColor\.fill\);/);
  });
});

describe('"what\'s on the card", on the screen, in the workout and the week editors (10-28)', () => {
  it('a row under the card in both, without opening a part', () => {
    expect(read('src/components/share/WorkoutShareEditor.tsx')).toMatch(/\{!inPart && \(\s*<div className="flex-none px-4 pt-2" data-whats-on>/);
    expect(read('src/components/share/WeekShareEditor.tsx')).toMatch(/\{!inPart && \(\s*<div className="flex-none px-4 pt-2" data-whats-on>/);
  });
  it('the logo has no switch — it is always on (Ofer)', () => {
    const row = read('src/components/share/WorkoutShareEditor.tsx').split('data-whats-on')[1].split('</div>\n      )}')[0];
    expect(row).not.toMatch(/brand|logo/i);
  });
  it('the numbers chosen are remembered per view', () => {
    expect(read('src/components/share/WorkoutShareEditor.tsx')).toMatch(/saveViewKeys\(template, keys\)/);
    expect(read('src/components/share/WorkoutShareEditor.tsx')).toMatch(/loadViewKeys\(next\) \?\? prev/);
  });
});
