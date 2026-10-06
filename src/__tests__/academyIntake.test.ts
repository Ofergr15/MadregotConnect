import { describe, expect, it, vi } from 'vitest';

import {
  clientIp, createRateLimiter, inviteUrl, isBotSubmit, isInviteFresh, looksLikeToken,
  sourceFromParam, splitName, HONEYPOT_FIELD,
} from '@/lib/academy/intake';
import { recordFormCandidate, invitePrefill } from '@/lib/academy/intake-server';
import { academyAcceptedEmail, academyInviteEmail } from '@/lib/email';
import { canAdmitToAcademy } from '@/lib/academy/pairing-server';

/**
 * The academy's two doors: a personal link a coach sends (door A) and the Instagram
 * landing page (door B). What must hold:
 *
 *  - a personal link lands on THE card it was sent from, and only while it is fresh
 *  - a door-B applicant who is already on the board is not added a second time
 *  - the form never overwrites what staff typed on a card
 *  - only the manager and academy coaches can let somebody in — a club coach cannot
 */

const TOKEN = 'a'.repeat(32);
const NOW = new Date('2026-09-30T10:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe('intake helpers', () => {
  it('keeps a personal link fresh for 30 days, then drops it', () => {
    expect(isInviteFresh(daysAgo(29), NOW)).toBe(true);
    expect(isInviteFresh(daysAgo(31), NOW)).toBe(false);
    expect(isInviteFresh(null, NOW)).toBe(false);
    expect(isInviteFresh('not a date', NOW)).toBe(false);
  });

  it('accepts only a 32-hex token', () => {
    expect(looksLikeToken(TOKEN)).toBe(true);
    expect(looksLikeToken('A'.repeat(32))).toBe(false);
    expect(looksLikeToken("x' or 1=1")).toBe(false);
    expect(looksLikeToken(undefined)).toBe(false);
  });

  it('builds the form link from the token', () => {
    expect(inviteUrl(TOKEN, 'https://www.madregot.app')).toBe(`https://www.madregot.app/academy-register?i=${TOKEN}`);
  });

  it('maps the landing source onto the two funnel sources', () => {
    expect(sourceFromParam('ig')).toBe('instagram');
    expect(sourceFromParam('instagram')).toBe('instagram');
    expect(sourceFromParam('tiktok')).toBe('form');
    expect(sourceFromParam(null)).toBe('form');
  });

  it('splits a stored name back into the two fields', () => {
    expect(splitName('Daniel Ben Levi')).toEqual({ firstName: 'Daniel', lastName: 'Ben Levi' });
    expect(splitName('  Noa  ')).toEqual({ firstName: 'Noa', lastName: '' });
    expect(splitName(null)).toEqual({ firstName: '', lastName: '' });
  });

  it('treats a filled honeypot as a bot, and only then', () => {
    expect(isBotSubmit({ [HONEYPOT_FIELD]: 'http://spam' })).toBe(true);
    expect(isBotSubmit({ [HONEYPOT_FIELD]: '   ' })).toBe(false);
    expect(isBotSubmit({})).toBe(false);
  });

  it('rate-limits per key within a window, and resets after it', () => {
    const allow = createRateLimiter(2, 1000);
    expect(allow('ip', 0)).toBe(true);
    expect(allow('ip', 10)).toBe(true);
    expect(allow('ip', 20)).toBe(false);
    expect(allow('other', 20)).toBe(true);
    expect(allow('ip', 1000)).toBe(true);
  });

  it('reads the first forwarded address', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }))).toBe('1.2.3.4');
    expect(clientIp(new Headers({ 'x-real-ip': '5.6.7.8' }))).toBe('5.6.7.8');
    expect(clientIp(new Headers())).toBe('unknown');
  });
});

// ── recordFormCandidate, against a tiny stateful table ────────────────────────

type Row = Record<string, any>;

function fakeDb(cards: Row[]) {
  const events: Row[] = [];
  const updates: Array<{ id: string; patch: Row }> = [];
  let seq = 0;
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let inserting: Row | null = null;
    let patch: Row | null = null;
    const rows = () => (table === 'academy_candidates' ? cards : events).filter(r => filters.every(f => f(r)));
    const settle = () => {
      if (inserting) return { data: [inserting], error: null };
      if (patch) {
        for (const r of rows()) { Object.assign(r, patch); updates.push({ id: r.id, patch }); }
        return { data: null, error: null };
      }
      return { data: rows(), error: null };
    };
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => { filters.push(r => r[c] === v); return q; },
      order: () => q,
      limit: () => q,
      insert: (row: Row) => { inserting = { id: `new-${++seq}`, archived_at: null, ...row }; cards.push(inserting); return q; },
      update: (p: Row) => { patch = p; return q; },
      upsert: (row: Row) => {
        if (!events.some(e => e.candidate_id === row.candidate_id && e.stage === row.stage)) events.push(row);
        return Promise.resolve({ data: null, error: null });
      },
      single: () => Promise.resolve({ ...settle(), data: settle().data?.[0] ?? null }),
      maybeSingle: () => { const s = settle(); return Promise.resolve({ data: s.data?.[0] ?? null, error: s.error }); },
      then: (ok: any, bad: any) => Promise.resolve(settle()).then(ok, bad),
    };
    return q;
  };
  return { client: { from } as any, cards, events, updates };
}

const base = { name: 'Dana Cohen', email: 'dana@gmail.com', phone: '0501234567', athleteId: 'ath-1' };

describe('recordFormCandidate', () => {
  it('lands a fresh personal link on its own card, even with a different email', async () => {
    const db = fakeDb([
      { id: 'c1', email: 'old@x.com', phone: null, athlete_id: null, archived_at: null, invite_token: TOKEN, invited_at: new Date().toISOString() },
    ]);
    const id = await recordFormCandidate(db.client, { ...base, inviteToken: TOKEN });
    expect(id).toBe('c1');
    expect(db.cards).toHaveLength(1);
    // Staff's email stays; the missing phone is filled; the account is linked.
    expect(db.cards[0]).toMatchObject({ email: 'old@x.com', phone: '0501234567', athlete_id: 'ath-1' });
    expect(db.events).toEqual([expect.objectContaining({ candidate_id: 'c1', stage: 'form' })]);
  });

  it('ignores a stale link and falls back to the email match', async () => {
    const db = fakeDb([
      { id: 'c1', email: 'other@x.com', phone: null, athlete_id: null, archived_at: null, invite_token: TOKEN, invited_at: '2020-01-01T00:00:00Z' },
      { id: 'c2', email: 'dana@gmail.com', phone: '0529999999', athlete_id: null, archived_at: null },
    ]);
    expect(await recordFormCandidate(db.client, { ...base, inviteToken: TOKEN })).toBe('c2');
    expect(db.cards.find(c => c.id === 'c2')!.phone).toBe('0529999999');
  });

  it('brings an archived card back instead of adding a second one', async () => {
    const db = fakeDb([{ id: 'c3', email: 'dana@gmail.com', phone: null, athlete_id: null, archived_at: '2026-09-01', archived_reason: 'no answer' }]);
    expect(await recordFormCandidate(db.client, base)).toBe('c3');
    expect(db.cards).toHaveLength(1);
    expect(db.cards[0]).toMatchObject({ archived_at: null, archived_reason: null });
  });

  it('makes a new Instagram card for a stranger, with form already stamped', async () => {
    const db = fakeDb([]);
    const id = await recordFormCandidate(db.client, { ...base, src: 'ig' });
    expect(id).toBe('new-1');
    expect(db.cards[0]).toMatchObject({ name: 'Dana Cohen', source: 'instagram', athlete_id: 'ath-1' });
    expect(db.events).toHaveLength(1);
  });

  it('never throws, so the applicant’s submit cannot fail on it', async () => {
    const boom = { from: () => { throw new Error('db down'); } } as any;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(recordFormCandidate(boom, base)).resolves.toBeNull();
    spy.mockRestore();
  });
});

describe('invitePrefill', () => {
  it('prefills from a fresh link only', async () => {
    const card = { id: 'c1', name: 'Dana Cohen', email: 'dana@gmail.com', phone: '050', invite_token: TOKEN, invited_at: new Date().toISOString() };
    expect(await invitePrefill(fakeDb([card]).client, TOKEN)).toEqual({ name: 'Dana Cohen', email: 'dana@gmail.com', phone: '050' });
    expect(await invitePrefill(fakeDb([{ ...card, invited_at: '2020-01-01' }]).client, TOKEN)).toBeNull();
    expect(await invitePrefill(fakeDb([card]).client, 'nope')).toBeNull();
  });
});

describe('academy mails', () => {
  it('puts the personal link in the invite and escapes the coach’s note', () => {
    const { html } = academyInviteEmail({ name: 'Dana', url: `https://x/academy-register?i=${TOKEN}`, note: '<b>hi</b>', senderName: 'Yossi' });
    expect(html).toContain(`academy-register?i=${TOKEN}`);
    expect(html).not.toContain('<b>hi</b>');
    expect(html).toContain('&lt;b&gt;hi&lt;/b&gt;');
  });

  it('sends a new trainee to /join and an existing member to the app', () => {
    expect(academyAcceptedEmail({ name: 'Dana', token: TOKEN, coachName: 'Yossi' }).html).toContain(`/join/${TOKEN}`);
    const member = academyAcceptedEmail({ name: 'Dana', token: null }).html;
    expect(member).toContain('/dashboard');
    expect(member).not.toContain('/join/');
  });
});

describe('who can let somebody in', () => {
  it('the manager and academy coaches, not a club coach', () => {
    expect(canAdmitToAcademy({ isSuperUser: true, role: 'runner' })).toBe(true);
    expect(canAdmitToAcademy({ isSuperUser: false, role: 'admin' })).toBe(true);
    expect(canAdmitToAcademy({ isSuperUser: false, role: 'academy_coach' })).toBe(false);
    expect(canAdmitToAcademy({ isSuperUser: false, role: 'coach' })).toBe(false);
    expect(canAdmitToAcademy({ isSuperUser: false, role: 'runner' })).toBe(false);
  });
});

describe('the form on a phone', () => {
  it('opens the number keyboard for age, weight and height, and no longer asks marital status', async () => {
    const { readFileSync } = await import('node:fs');
    const page = readFileSync('src/app/academy-register/page.tsx', 'utf8');
    for (const key of ['weight', 'height']) {
      expect(page).toMatch(new RegExp(`key: '${key}'[^\\n]*inputMode: '(numeric|decimal)'`));
    }
    expect(page).toContain("label: 'גובה (בס״מ)'");
    expect(page).not.toContain('maritalStatus');
  });
});

describe('the registrations screen', () => {
  it('does not show marital status, even on registrations that answered it', async () => {
    const { readFileSync } = await import('node:fs');
    const screen = readFileSync('src/components/AcademyRegistrations.tsx', 'utf8');
    expect(screen).not.toContain('סטטוס משפחתי');
    expect(screen).toContain("RETIRED_KEYS = new Set(['maritalStatus'])");
    expect(screen).toContain('.filter(([k]) => !RETIRED_KEYS.has(k))');
  });
});

describe('the form: how did you hear about us', () => {
  const page = () => require('node:fs').readFileSync('src/app/academy-register/page.tsx', 'utf8') as string;

  it('is a choice of four, and "other" opens a line to type in', () => {
    expect(page()).toContain("key: 'hearAbout', label: 'איך שמעת על קבוצת הריצה', type: 'radio', options: ['אינסטגרם', 'פייסבוק', 'חברים', 'אחר']");
    expect(page()).toContain("hearAboutOther: { on: 'hearAbout', when: a => a === 'אחר' }");
  });

  it('no longer asks for the Strava name or the Instagram page', () => {
    expect(page()).not.toMatch(/key: 'strava'/);
    expect(page()).not.toMatch(/key: 'instagram'/);
  });
});

describe('number fields on the form', () => {
  it('keep digits only, and one decimal point for weight', async () => {
    const { numberOnly } = await import('@/lib/academy/intake');
    expect(numberOnly('3a4 ', false)).toBe('34');
    expect(numberOnly('1.80', false)).toBe('180');
    expect(numberOnly('72,5', true)).toBe('72.5');
    expect(numberOnly('7.2.5', true)).toBe('7.25');
    expect(numberOnly('', true)).toBe('');
  });

  it('open the big keypad: a text input with inputMode and a digits pattern', () => {
    const page = require('node:fs').readFileSync('src/app/academy-register/page.tsx', 'utf8') as string;
    expect(page).toContain("type={f.type === 'number' ? 'text' : f.type}");
    expect(page).toContain("'[0-9]*'");
  });
});

describe('the form: medical details', () => {
  it('opens only once something other than "healthy" is ticked', () => {
    const page = require('node:fs').readFileSync('src/app/academy-register/page.tsx', 'utf8') as string;
    expect(page).toContain("medicalDetails: { on: 'medicalHistory', when: a => !!a && a !== HEALTHY }");
    expect(page).toContain("{ key: 'medicalHistory', label: 'עבר רפואי', type: 'radio', required: true");
  });
});

describe('academy link previews', () => {
  it('say "academy", not the club line inherited from the root layout', async () => {
    const reg = (await import('@/app/academy-register/layout')).metadata as any;
    const land = (await import('@/app/academy/page')).metadata as any;
    for (const m of [reg, land]) {
      expect(m.openGraph.title).toContain('אקדמיית מדרגות');
      expect(m.openGraph.description).not.toContain("Israel's leading running community");
      expect(m.openGraph.siteName).toBe('Madregot Academy');
    }
  });
});

describe('the form: birth date and units', () => {
  const page = () => require('node:fs').readFileSync('src/app/academy-register/page.tsx', 'utf8') as string;

  it('asks the birth date instead of the age, and says weight is in kg', () => {
    expect(page()).toContain("{ key: 'birthDate', label: 'תאריך לידה', type: 'date', required: true }");
    expect(page()).not.toMatch(/key: 'age'/);
    expect(page()).toContain("label: 'משקל (בק״ג)'");
  });

  it('shows the birth date on the registrations screen with the age next to it', async () => {
    const { birthDateLabel } = await import('@/components/AcademyRegistrations');
    const now = new Date('2026-09-30T12:00:00');
    expect(birthDateLabel('1990-03-12', now)).toBe('12.03.1990 (36)');
    expect(birthDateLabel('1990-10-01', now)).toBe('01.10.1990 (35)');
    expect(birthDateLabel('', now)).toBe('—');
  });
});

describe('the form: shoe size', () => {
  it('asks the shoe size from the EU list instead of the sock span', () => {
    const page = require('node:fs').readFileSync('src/app/academy-register/page.tsx', 'utf8') as string;
    expect(page).toContain("{ key: 'shoeSize', label: 'מה מידת הנעליים שלך', type: 'select', required: true, options: EU_SHOE_SIZES }");
    expect(page).not.toMatch(/key: 'socksSize'/);
    expect(page).toContain("f.type === 'select' && (");
  });
});

describe('the form: running background', () => {
  it('asks the past year in words, first on its page, and no longer asks the goal', () => {
    const page = require('node:fs').readFileSync('src/app/academy-register/page.tsx', 'utf8') as string;
    expect(page).toContain("{ key: 'runningHistory', label: 'מה היה הרקע שלך בריצה בשנה האחרונה?', type: 'textarea', required: true }");
    expect(page).not.toMatch(/key: 'goal'/);
    expect(page).toContain("keys: ['runningHistory', 'group',");
  });
});

describe('the form: birth date pickers', () => {
  const page = () => require('node:fs').readFileSync('src/app/academy-register/page.tsx', 'utf8') as string;

  it('uses three selects, not the native date box that overflows on iOS', () => {
    expect(page()).toContain('<DateParts ');
    expect(page()).not.toMatch(/f\.type === 'number' \|\| f\.type === 'date'\) && \(/);
  });

  it('refuses a half-picked or impossible date', () => {
    expect(page()).toContain("if (f.type === 'date' && !isWholeDate(v))");
    expect(page()).toContain('d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])');
  });
});

describe('the form on a phone: width', () => {
  it('pushes nothing off-screen, which in RTL widens the page and shifts it sideways', () => {
    const page = require('node:fs').readFileSync('src/app/academy-register/page.tsx', 'utf8') as string;
    expect(page).not.toMatch(/left:\s*'-\d+px'/);
    expect(page).toContain("clipPath: 'inset(50%)'");
  });
});

describe('the academy pages and the service worker', () => {
  it('are always fetched from the network, before any page cache rule', () => {
    const sw = require('node:fs').readFileSync('src/app/sw.ts', 'utf8') as string;
    const rule = sw.indexOf("pathname === '/academy' || pathname === '/academy-register'");
    expect(rule).toBeGreaterThan(-1);
    expect(sw.indexOf('handler: new NetworkOnly()', rule)).toBeGreaterThan(rule);
    expect(rule).toBeLessThan(sw.indexOf('handler: pageCache('));
  });
});

describe('the form: thank-you screen', () => {
  it('shows the club logo and thanks the applicant by the academy name', () => {
    const page = require('node:fs').readFileSync('src/app/academy-register/page.tsx', 'utf8') as string;
    expect(page).toContain('src="/images/logo.png"');
    expect(page).toContain('תודה שפנית לאקדמיית הריצה של מדרגות');
    expect(page).toContain('נחזור אליך בימים הקרובים לשיחת היכרות קצרה');
  });
});
