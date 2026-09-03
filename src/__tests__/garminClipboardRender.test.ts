import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { renderGarminClipboardPng } from '@/lib/run-chat/garmin-clipboard';
import { DEJAVU_SANS_BASE64 } from '@/lib/run-chat/dejavu-sans.generated';

describe('Garmin clipboard rendering', () => {
  it('bundles a Hebrew font and renders a valid PNG', async () => {
    const font = readFileSync(
      join(process.cwd(), 'src/assets/fonts/DejaVuSans-Hebrew-Latin-Subset.ttf'),
    );
    expect(font.byteLength).toBeGreaterThan(50_000);
    expect(Buffer.from(DEJAVU_SANS_BASE64, 'base64')).toEqual(font);

    const png = await renderGarminClipboardPng({
      title: 'תוכנית אימון',
      prompt: '900 מ׳ חימום',
      source: 'prompt_edit',
      segments: [
        {
          kind: 'warmup',
          label: 'חימום',
          detail: '900 מ׳ קל',
          distanceM: 900,
        },
      ],
    });
    const metadata = await sharp(png).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(390);
    expect(metadata.height).toBeGreaterThan(100);

    // The title is the only dark content in this region. This guards against
    // production renders that keep the bars but silently drop every glyph.
    const { data, info } = await sharp(png)
      .extract({ left: 15, top: 12, width: 220, height: 34 })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let darkOpaquePixels = 0;
    for (let offset = 0; offset < data.length; offset += info.channels) {
      if (
        data[offset] < 100 &&
        data[offset + 1] < 100 &&
        data[offset + 2] < 100 &&
        data[offset + 3] > 200
      ) {
        darkOpaquePixels += 1;
      }
    }
    expect(darkOpaquePixels).toBeGreaterThan(100);

    const differentDigits = await renderGarminClipboardPng({
      title: 'תוכנית אימון',
      prompt: '111 מ׳ חימום',
      source: 'prompt_edit',
      segments: [
        {
          kind: 'warmup',
          label: 'חימום',
          detail: '111 מ׳ קל',
          distanceM: 900,
        },
      ],
    });
    expect(differentDigits.equals(png)).toBe(false);
  });
});
