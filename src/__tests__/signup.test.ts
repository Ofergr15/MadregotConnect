import { describe, it, expect } from 'vitest';
import {
  isHumanName, isLikelyEmail, normaliseEmail, placeholderNameFromEmail, signupAlertName,
} from '@/lib/signup';

describe('isLikelyEmail', () => {
  it('accepts ordinary addresses', () => {
    for (const ok of ['dana@gmail.com', 'a.b+tag@sub.domain.co.il', 'x_y-z@mail.org']) {
      expect(isLikelyEmail(ok), ok).toBe(true);
    }
  });

  it('rejects the typos a form actually produces', () => {
    for (const bad of ['', ' ', 'dana', 'dana@', '@gmail.com', 'dana@gmail', 'dana gmail.com', 'a@b.c']) {
      expect(isLikelyEmail(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('tolerates surrounding whitespace, which a paste from WhatsApp carries', () => {
    expect(isLikelyEmail('  dana@gmail.com  ')).toBe(true);
  });

  it('is null-safe — the body field is optional', () => {
    expect(isLikelyEmail(null)).toBe(false);
    expect(isLikelyEmail(undefined)).toBe(false);
  });
});

describe('normaliseEmail', () => {
  // The pending-email unique index does NOT lower(), so the API must.
  it('lowercases and trims, so the unique index holds', () => {
    expect(normaliseEmail('  Dana.Levi@Gmail.COM ')).toBe('dana.levi@gmail.com');
  });
});

describe('placeholderNameFromEmail', () => {
  it('reads a name out of the local part', () => {
    expect(placeholderNameFromEmail('dana.levi@gmail.com')).toBe('Dana Levi');
    expect(placeholderNameFromEmail('amit_lazar@gmail.com')).toBe('Amit Lazar');
    expect(placeholderNameFromEmail('yair-gb@gmail.com')).toBe('Yair Gb');
  });

  it('drops digits — "dana.levi92" is a person called Dana Levi', () => {
    expect(placeholderNameFromEmail('dana.levi92@gmail.com')).toBe('Dana Levi');
    expect(placeholderNameFromEmail('runner2026@gmail.com')).toBe('Runner');
  });

  it('handles a single word and a plus-tag', () => {
    expect(placeholderNameFromEmail('ofer@gmail.com')).toBe('Ofer');
    expect(placeholderNameFromEmail('ofer+club@gmail.com')).toBe('Ofer Club');
  });

  it('normalises before splitting, so case in the address does not leak through', () => {
    expect(placeholderNameFromEmail('DANA.LEVI@GMAIL.COM')).toBe('Dana Levi');
  });

  // athletes.name is NOT NULL, so the one thing this must never return is ''.
  it('never returns empty, however unname-like the address', () => {
    expect(placeholderNameFromEmail('42@x.co')).toBe('42@x.co');
    expect(placeholderNameFromEmail('___@x.co')).toBe('___@x.co');
    expect(placeholderNameFromEmail('@x.co')).toBe('@x.co');
  });
});

// The staff sign-up alert said "Strava Athlete · 26 בקשות ממתינות לאישור" and the
// admin asked to be told WHO is trying to get in. Everything below is the gate
// between "a string arrived in the name slot" and "a coach can read a person off
// their lock screen".
describe('isHumanName', () => {
  it('accepts the names the club actually uses', () => {
    for (const ok of ['רועי רות', 'Yosi Sabag', 'Dana', 'Jean-Luc', 'אסף אלקסלסי']) {
      expect(isHumanName(ok), ok).toBe(true);
    }
  });

  it('rejects an address, synthetic or real — no name has an @ in it', () => {
    expect(isHumanName('strava_659081577@strava.madregot.local')).toBe(false);
    expect(isHumanName('dana.levi92@gmail.com')).toBe(false);
  });

  it('rejects Strava’s "we will not say" and our own "Strava <id>" stand-in', () => {
    // Measured in production: Strava answers firstname "Strava" / lastname "Athlete"
    // for an account whose profile it withholds, and the callback's own fallback is
    // "Strava <id>". Both are non-answers wearing a name's clothes.
    for (const bad of ['Strava Athlete', 'strava athlete', 'Strava 659081577', 'Strava', 'strava_user']) {
      expect(isHumanName(bad), bad).toBe(false);
    }
  });

  it('does not reject a person whose name merely starts with Strava-ish text', () => {
    expect(isHumanName('Stravinsky')).toBe(true);
    expect(isHumanName('Strava Fanclub Dana')).toBe(true);
  });

  it('is null-safe and whitespace-safe', () => {
    expect(isHumanName(null)).toBe(false);
    expect(isHumanName(undefined)).toBe(false);
    expect(isHumanName('   ')).toBe(false);
  });
});

describe('signupAlertName', () => {
  it('prefers the roster name — it is the one the club knows them by', () => {
    expect(signupAlertName({
      athleteName: 'רועי רות',
      providerName: 'Roy Roth',
      email: 'roy.m.roth@gmail.com',
    })).toBe('רועי רות');
  });

  it('falls back to the provider name for a row created seconds ago', () => {
    expect(signupAlertName({
      athleteName: 'Strava 659081577',
      providerName: 'Yosi Sabag',
      email: 'strava_659081577@strava.madregot.local',
    })).toBe('Yosi Sabag');
  });

  it('derives a name from a REAL address as a last resort', () => {
    expect(signupAlertName({ email: 'dana.levi92@gmail.com' })).toBe('Dana Levi');
  });

  it('never derives one from the synthetic address — "Strava" is not their name', () => {
    expect(signupAlertName({ email: 'strava_659081577@strava.madregot.local' })).toBeNull();
  });

  it('answers null rather than a filler, so the locale-aware "someone" wins', () => {
    // The exact production case: no roster name, no provider name, no real address.
    expect(signupAlertName({
      athleteName: 'Strava Athlete',
      providerName: 'Strava Athlete',
      email: 'strava_659081577@strava.madregot.local',
    })).toBeNull();
    expect(signupAlertName({})).toBeNull();
  });

  it('rejects an address whose local part yields nothing name-like', () => {
    // placeholderNameFromEmail returns the address itself there, which is right for
    // a NOT NULL column and wrong for a push notification.
    expect(signupAlertName({ email: '42@x.co' })).toBeNull();
  });

  it('trims, so a stray space in a Strava profile is not pushed', () => {
    expect(signupAlertName({ providerName: '  Shay Noam ' })).toBe('Shay Noam');
  });
});
