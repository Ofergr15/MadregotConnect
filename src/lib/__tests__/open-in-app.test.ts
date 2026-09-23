import { describe, expect, it } from 'vitest';
import { openDecision, openInAppHref, safeTarget } from '@/lib/open-in-app';

describe('safeTarget', () => {
  it('keeps a path on this site', () => {
    expect(safeTarget('/dashboard/entry-queue?at=mine')).toBe('/dashboard/entry-queue?at=mine');
  });
  it('refuses anything that could leave the site', () => {
    for (const bad of [null, undefined, '', 'https://evil.example', '//evil.example', '/\\evil.example', 'dashboard']) {
      expect(safeTarget(bad)).toBe('/dashboard');
    }
  });
});

describe('openInAppHref', () => {
  it('encodes the path into the to param', () => {
    expect(openInAppHref('https://www.madregot.app', '/dashboard/entry-queue?at=mine'))
      .toBe('https://www.madregot.app/open?to=%2Fdashboard%2Fentry-queue%3Fat%3Dmine');
  });
});

describe('openDecision', () => {
  it('stops only iOS Safari outside the installed app', () => {
    expect(openDecision({ standalone: false, iosSafari: true })).toBe('handoff');
    expect(openDecision({ standalone: true, iosSafari: true })).toBe('forward');
    expect(openDecision({ standalone: false, iosSafari: false })).toBe('forward');
  });
});
