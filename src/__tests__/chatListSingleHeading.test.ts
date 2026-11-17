import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import { AREA_TITLE } from '@/lib/academy/areas';

const SRC = fileURLToPath(new URL('../', import.meta.url));

// Bug #20: the chats area showed "שיחות" twice — AcademyShell's <h1> (AREA_TITLE.threads)
// and then ChatList's own <h2>. The shell owns the title.
describe('chats area heading', () => {
  it('ChatList does not repeat the area title', () => {
    const src = readFileSync(join(SRC, 'components/academy/ChatList.tsx'), 'utf8');
    expect(AREA_TITLE.threads).toBe('שיחות');
    expect(src).not.toMatch(/<h[1-3][^>]*>\s*שיחות\s*<\/h[1-3]>/);
  });
});
