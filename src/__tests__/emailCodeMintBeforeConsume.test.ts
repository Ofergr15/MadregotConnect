import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Verify mints the session BEFORE consuming the code, so a mint failure keeps the code usable. */
const src = readFileSync(join(process.cwd(), 'src/app/api/auth/email-code/route.ts'), 'utf8');
const verify = src.slice(src.indexOf("action === 'verify'") > -1 ? src.indexOf('codeMatches(email, code') : 0);

describe('email-code verify order', () => {
  it('createSyntheticSession runs before the login_codes delete and before invited → active', () => {
    const mint = verify.indexOf('createSyntheticSession(admin, email');
    const consume = verify.indexOf("from('login_codes').delete()");
    const activate = verify.indexOf("update({ status: 'active' })");
    expect(mint).toBeGreaterThan(-1);
    expect(consume).toBeGreaterThan(mint);
    expect(activate).toBeGreaterThan(mint);
  });
  it('a mint failure says the same code may be retried', () => {
    expect(verify).toMatch(/\{ error: 'failed', retry: 'same-code' \}, \{ status: 500 \}/);
  });
});
