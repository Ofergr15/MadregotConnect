import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Anonymous routes must not echo the database's own error text (port of 32e6ae1a).
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('public routes keep DB error text in the log, not the response', () => {
  it.each(['app/api/academy/register/route.ts', 'app/api/public/current-plan/route.ts'])('%s', (p) => {
    expect(read(p)).not.toMatch(/error:\s*error\.message\s*\|\|/);
  });
});
