import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CROSS_CUTTING_QUESTIONS, FLOW_STEPS, allScreens, flowCounts,
} from '@/lib/academy/flow-map';

/**
 * The academy walkthrough, checked against the repo it describes.
 *
 * This is the one page whose whole value is that it tells the truth about what exists. A link to a
 * renamed preview, or a tab that no longer deep-links, turns the index into a page that says the
 * flow is complete while a piece of it is unreachable — and it fails silently, because a dead
 * internal link renders as a perfectly normal button.
 */

const ROOT = process.cwd();
const academyPage = readFileSync(join(ROOT, 'src/app/(app)/dashboard/academy/page.tsx'), 'utf8');

describe('every screen the walkthrough links exists', () => {
  it.each(allScreens().filter(s => s.kind === 'preview'))('preview %s', ({ href }) => {
    // The query string chooses a state inside a preview (`?card=1`); the route is the path.
    const path = href.split('?')[0];
    expect(path.startsWith('/preview/')).toBe(true);
    expect(existsSync(join(ROOT, 'src/app', path, 'page.tsx'))).toBe(true);
  });

  it.each(allScreens().filter(s => s.kind === 'app'))('in-app %s', ({ href }) => {
    const [path, query] = href.split('?');
    expect(existsSync(join(ROOT, 'src/app/(app)', path, 'page.tsx'))).toBe(true);

    // A `?tab=` link only works if the page's own allow-list accepts that value. `payments` was
    // absent from it from the day the tab shipped, so the tab had no working URL at all.
    const tab = new URLSearchParams(query || '').get('tab');
    if (tab) {
      const valid = academyPage.slice(academyPage.indexOf('const valid: Tab[]'));
      expect(valid.slice(0, 400)).toContain(`'${tab}'`);
    }
  });
});

describe('the academy page can be deep-linked to every tab it has', () => {
  it('has no tab missing from the allow-list', () => {
    // Derived from the source rather than listed here, so a new tab is caught the moment it is
    // added instead of the day somebody shares its URL.
    const union = academyPage.match(/type Tab = ([^;]+);/);
    expect(union).not.toBeNull();
    const tabs = [...(union as RegExpMatchArray)[1].matchAll(/'([a-z-]+)'/g)].map(m => m[1]);
    expect(tabs.length).toBeGreaterThan(10);

    const valid = academyPage.slice(academyPage.indexOf('const valid: Tab[]'), academyPage.indexOf('const valid: Tab[]') + 400);
    const missing = tabs.filter(t => !valid.includes(`'${t}'`));
    expect(missing).toEqual([]);
  });
});

describe('the shape of the walkthrough', () => {
  it('is the fifteen steps, numbered once each, in order', () => {
    expect(FLOW_STEPS.map(s => s.n)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  });

  it('gives every step an owner and the tool it runs on today', () => {
    for (const step of FLOW_STEPS) {
      expect(step.title.length).toBeGreaterThan(2);
      expect(step.owner.length).toBeGreaterThan(1);
      expect(step.today.length).toBeGreaterThan(1);
    }
  });

  it('claims a change only where there is a screen to show for it', () => {
    // The inverse is allowed — a step can have a screen and no new behaviour — but a sentence
    // about what was built with nothing to open is the kind of claim this page must not make.
    for (const step of FLOW_STEPS) {
      if (step.built) expect(step.screens.length, step.title).toBeGreaterThan(0);
    }
  });

  it('says nothing was built for the steps that stay outside the app', () => {
    // Yossi's phone call and the general WhatsApp group are deliberate non-features. Showing them
    // as gaps would invite building things nobody asked for.
    for (const step of FLOW_STEPS.filter(s => s.state === 'outsideApp')) {
      expect(step.built).toBe('');
      expect(step.screens).toEqual([]);
    }
  });
});

describe('the open questions', () => {
  it('counts every one of them, including the ones not tied to a step', () => {
    const perStep = FLOW_STEPS.reduce((n, s) => n + s.questions.length, 0);
    expect(perStep).toBeGreaterThan(0);
    expect(flowCounts().questions).toBe(perStep + CROSS_CUTTING_QUESTIONS.length);
  });

  it('names the money decisions on the payment step, where they are answerable', () => {
    const payment = FLOW_STEPS.find(s => s.n === 14);
    expect(payment?.questions.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps the Caliber fork attached to the step it decides', () => {
    const signup = FLOW_STEPS.find(s => s.n === 5);
    expect(signup?.questions.join(' ')).toContain('Caliber');
  });

  it('does not repeat a question in two places', () => {
    const all = [...FLOW_STEPS.flatMap(s => s.questions), ...CROSS_CUTTING_QUESTIONS];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('the counts the header prints', () => {
  it('add up to the fifteen steps', () => {
    const c = flowCounts();
    expect(c.inApp + c.partly + c.outsideApp).toBe(c.steps);
    expect(c.steps).toBe(15);
  });
});
