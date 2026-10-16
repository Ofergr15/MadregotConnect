import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createTranslator } from 'next-intl';
import he from '../../messages/he.json';
import en from '../../messages/en.json';
import { addressingOf, parseAddressing, ADDRESSING_OPTIONS } from '@/lib/academy/addressing';
import { testConfirmedCopy, testSubmittedCopy } from '@/lib/academy/loop-notify';

/**
 * "פנייה" (launch T5 / U16, as Ofer reshaped it): the form does NOT ask how to address the
 * applicant; the manager or the trainee's coach sets it on the card, into the profile's own
 * `athletes.gender`, and the gendered texts follow it. Unknown keeps today's wording.
 */

// ── The route: PUT /api/academy/addressing ──────────────────────────────────────────────
const updates: Array<{ id: unknown; patch: Record<string, unknown> }> = [];
let rowExists = true;
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => {
      let patch: Record<string, unknown> = {};
      let id: unknown = null;
      const q: any = {
        update(p: Record<string, unknown>) { patch = p; return q; },
        eq(col: string, v: unknown) { if (col === 'id') id = v; return q; },
        select() { return q; },
        maybeSingle() {
          if (!rowExists) return Promise.resolve({ data: null, error: null });
          updates.push({ id, patch });
          return Promise.resolve({ data: { id, gender: patch.gender ?? null }, error: null });
        },
      };
      return q;
    },
  }),
}));
const caller = { athleteId: 'coach-1', isStaff: true, isSuperUser: false, role: 'academy_coach', roles: [] };
vi.mock('@/lib/auth/self-or-staff', async (orig) => ({
  ...(await orig<object>()),
  resolveVerifiedCaller: async () => ({ denied: null, caller }),
}));
const mayCoach = vi.fn();
vi.mock('@/lib/academy/pairing-server', async (orig) => ({
  ...(await orig<object>()),
  mayCoach: (...a: unknown[]) => mayCoach(...a),
}));

const { PUT } = await import('@/app/api/academy/addressing/route');
const put = (body: unknown) => PUT(new Request('http://x/api/academy/addressing', { method: 'PUT', body: JSON.stringify(body) }));

describe('PUT /api/academy/addressing', () => {
  beforeEach(() => { updates.length = 0; rowExists = true; mayCoach.mockReset(); mayCoach.mockResolvedValue(true); });

  it("writes the trainee's athletes.gender, and null clears it", async () => {
    const res = await put({ athleteId: 'noa', gender: 'female' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ athleteId: 'noa', gender: 'female' });
    await put({ athleteId: 'noa', gender: null });
    expect(updates).toEqual([{ id: 'noa', patch: { gender: 'female' } }, { id: 'noa', patch: { gender: null } }]);
  });

  it('is the manager or their coach only: anyone else gets a 404 and nothing is written', async () => {
    mayCoach.mockResolvedValue(false);
    const res = await put({ athleteId: 'noa', gender: 'male' });
    expect(res.status).toBe(404);
    expect(updates).toEqual([]);
    expect(mayCoach).toHaveBeenCalledWith(caller, 'noa');
  });

  it('refuses anything but the two answers or null', async () => {
    for (const body of [{ athleteId: 'noa', gender: 'other' }, { athleteId: 'noa' }, { gender: 'male' }]) {
      expect((await put(body)).status).toBe(400);
    }
    expect(updates).toEqual([]);
  });

  it('404s an athlete that is not in the club', async () => {
    rowExists = false;
    expect((await put({ athleteId: 'ghost', gender: 'male' })).status).toBe(404);
  });
});

describe('the addressing value', () => {
  it('reads anything unknown as not set', () => {
    expect(addressingOf('female')).toBe('female');
    expect(addressingOf('male')).toBe('male');
    for (const v of [null, undefined, '', 'other', 'F']) expect(addressingOf(v)).toBeNull();
  });

  it('offers זכר / נקבה and a way back to unknown', () => {
    expect(ADDRESSING_OPTIONS.map(o => o.label)).toEqual(['זכר', 'נקבה', 'לא ידוע']);
    expect(ADDRESSING_OPTIONS.map(o => o.value)).toEqual(['male', 'female', null]);
    expect(parseAddressing({ athleteId: 'a', gender: '' })).toEqual({ ok: true, athleteId: 'a', gender: null });
  });
});

describe('the gendered texts follow it', () => {
  it('the approval card: "שלחה טסט" for her, "שלח טסט" for him and when unknown', () => {
    const t = createTranslator({ locale: 'he', messages: he as any, namespace: 'completion.approve' as any });
    const bdi = (c: unknown) => c;
    const plain = (x: unknown) => (Array.isArray(x) ? x.join('') : String(x));
    expect(plain(t.rich('sentRich' as any, { name: 'Noa', gender: 'female', bdi } as any))).toBe('Noa שלחה טסט');
    expect(plain(t.rich('sentRich' as any, { name: 'Yoav', gender: 'male', bdi } as any))).toBe('Yoav שלח טסט');
    expect(plain(t.rich('sentRich' as any, { name: 'Alex', gender: 'other', bdi } as any))).toBe('Alex שלח טסט');
    expect(t('sent' as any, { name: 'Noa', gender: 'female' } as any)).toBe('Noa שלחה טסט');
    const te = createTranslator({ locale: 'en', messages: en as any, namespace: 'completion.approve' as any });
    expect(te('sent' as any, { name: 'Noa', gender: 'female' } as any)).toBe('Noa sent a test');
  });

  it("the coach's pushes about the trainee", () => {
    expect(testSubmittedCopy('he', { trainee: 'Noa', gender: 'female' }).title).toBe('🎯 Noa שלחה תוצאת טסט');
    expect(testSubmittedCopy('he', { trainee: 'Yoav', gender: 'male' }).title).toBe('🎯 Yoav שלח תוצאת טסט');
    expect(testSubmittedCopy('he', { trainee: 'Alex' }).title).toBe('🎯 Alex שלח/ה תוצאת טסט');
    expect(testConfirmedCopy('he', { trainee: 'Noa', gender: 'female' }).title).toBe('🎯 Noa אישרה מועד לטסט');
    expect(testConfirmedCopy('he', { trainee: 'Alex', gender: null }).title).toBe('🎯 Alex אישר/ה מועד לטסט');
    expect(testSubmittedCopy('en', { trainee: 'Noa', gender: 'female' }).title).toBe('🎯 Noa sent a test result');
  });
});

describe('the registration form', () => {
  const page = readFileSync(join(__dirname, '..', 'app/academy-register/page.tsx'), 'utf8');
  const fields = page.slice(page.indexOf('const FIELDS'), page.indexOf('const STEPS'));

  it('does not ask how to address the applicant (staff set it from the intro call)', () => {
    expect(page).not.toContain('איך לפנות');
    expect(fields).not.toMatch(/key:\s*'(gender|addressing)'/);
  });

  it('still asks all twenty questions, under the same keys', () => {
    const keys = [...fields.matchAll(/\bkey:\s*'([^']+)'/g)].map(m => m[1]);
    expect(keys).toEqual([
      'firstName', 'lastName', 'email', 'phone', 'focus', 'birthDate', 'weight', 'height', 'city', 'group',
      'runningHistory', 'achievements', 'medicalHistory', 'medicalDetails', 'hearAbout', 'hearAboutOther',
      'shirtSize', 'pantsSize', 'tightsSize', 'shoeSize',
    ]);
    // Every one of them is on a page.
    const steps = page.slice(page.indexOf('const STEPS'), page.indexOf('const FIELD_BY_KEY'));
    for (const k of keys) expect(steps, k).toContain(`'${k}'`);
  });
});
