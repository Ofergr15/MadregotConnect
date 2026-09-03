import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { renderGarminClipboardPng } from '@/lib/run-chat/garmin-clipboard';

describe('Garmin clipboard rendering', () => {
  it('bundles a Hebrew font and renders a valid PNG', async () => {
    const font = readFileSync(
      join(process.cwd(), 'src/assets/fonts/NotoSansHebrew-Regular.ttf'),
    );
    expect(font.byteLength).toBeGreaterThan(20_000);

    const png = await renderGarminClipboardPng({
      title: 'תוכנית אימון',
      prompt: '2 ק״מ חימום',
      source: 'prompt_edit',
      segments: [
        {
          kind: 'warmup',
          label: 'חימום',
          detail: '2 ק״מ קל',
          distanceM: 2000,
        },
      ],
    });
    const metadata = await sharp(png).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(390);
    expect(metadata.height).toBeGreaterThan(100);
  });
});
