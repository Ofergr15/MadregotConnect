import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const join = readFileSync('src/components/join/JoinFlow.tsx', 'utf8');

describe('join flow copy', () => {
  it('#22 step 1 shows "מצטרפים למדרגות" once (title only, no eyebrow)', () => {
    expect(join).toMatch(/hero\('מצטרפים למדרגות 👋', '[^']*', null\)/);
  });
});
