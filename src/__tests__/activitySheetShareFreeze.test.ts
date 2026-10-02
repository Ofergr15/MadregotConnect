import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// "ניסיתי לשתף לסטורי, המסך נתקע" (2026-10-02): the activity sheet is a modal
// drawer, which sets pointer-events: none on the body; the share editor is a
// full-screen portal outside the drawer, so it inherited none and took no taps.
const SRC = readFileSync(join(__dirname, '../components/ActivitySyncEditor.tsx'), 'utf8');

describe('the activity sheet steps aside for the share editor', () => {
  it('is closed by its prop while the editor is up, not dismissed', () => {
    expect(SRC).toMatch(/<Sheet\s+open=\{!showShare\}\s+onOpenChange=\{\(open\) => \{ if \(!open\) onClose\(\); \}\}/);
  });
  it('keeps the editor mounted beside the sheet, so it comes back after', () => {
    expect(SRC).toMatch(/<\/Sheet>\s+\{showShare && feedItem && \(\s+<ShareSheet subject=\{\{ kind: 'workout', item: feedItem \}\} onClose=\{\(\) => setShowShare\(false\)\} \/>/);
  });
});
