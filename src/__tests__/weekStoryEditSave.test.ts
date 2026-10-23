import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

// The weekly story's "סיום" said "can't save" on Ofer's iPhone (10-23): prod logs show
// PUT /api/admin/stories → 401 every time. The player's fetches carried no bearer token —
// the app's routes read the caller from `Authorization`, which only apiHeaders() adds.

const updates: Array<{ table: string; patch: Record<string, unknown> }> = [];
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) => ({ eq: async () => { updates.push({ table, patch }); return { error: null }; } }),
    }),
  }),
}));
vi.mock('@/lib/auth/self-or-staff', async () => {
  const { NextResponse } = await import('next/server');
  return {
    resolveVerifiedCaller: async (req: Request) => (req.headers.get('authorization')?.startsWith('Bearer ')
      ? { denied: null, caller: { athleteId: '9fd3d199-ec5d-48fe-bc4a-94db06f48863', isSuperUser: false, roles: ['admin'], role: 'admin' } }
      : { denied: NextResponse.json({ error: 'unauthorized' }, { status: 401 }), caller: null }),
  };
});
vi.mock('@/lib/auth/roles', () => ({ hasRole: (c: { roles?: string[] }, r: string) => !!c?.roles?.includes(r) }));

// The body exactly as WeekStory's finishEdit builds it after a colour change.
const body = JSON.stringify({ feature: 'weekly', layout: { hiddenSlides: [], hiddenParts: {}, workout: null, theme: '#F4E8AF' } });

describe('saving the story layout', () => {
  it('the route saves the layout the editor sends (custom colour included) for the operator admin', async () => {
    const { PUT } = await import('@/app/api/admin/stories/route');
    const r = await PUT(new Request('http://x/api/admin/stories', { method: 'PUT', headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body }));
    expect(r.status).toBe(200);
    expect(updates.at(-1)).toMatchObject({ table: 'story_feature_settings', patch: { layout: { theme: '#F4E8AF' } } });
  });
  it('without the bearer it is the 401 prod logged', async () => {
    const { PUT } = await import('@/app/api/admin/stories/route');
    const r = await PUT(new Request('http://x/api/admin/stories', { method: 'PUT', headers: { 'content-type': 'application/json' }, body }));
    expect(r.status).toBe(401);
  });
  it('every fetch in the player sends the app\'s auth headers', () => {
    const src = readFileSync('src/components/week-story/WeekStory.tsx', 'utf8');
    const calls = [...src.matchAll(/fetch\('\/api\/[^']+',\s*\{[^}]*headers:\s*([^,}]+)/g)].map((m) => m[1].trim());
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const h of calls) expect(h).toBe('await apiHeaders(true)');
  });
  it('the failure says why', async () => {
    const { saveError } = await import('@/components/week-story/WeekStory');
    expect(saveError('401')).toMatch(/החיבור פג/);
    expect(saveError('403')).toMatch(/הרשאה|הרשאת/);
    expect(saveError('no_layout_column')).toMatch(/170/);
    expect(saveError('500')).toMatch(/שרת/);
  });
});

describe('the summary line', () => {
  it('renders each fact as its own chip, every number isolated', async () => {
    const { SummaryChips } = await import('@/components/week-story/WeekStory');
    const html = renderToStaticMarkup(createElement(SummaryChips, { tags: ['⚡ 10 × 1.6 ק״מ ביעד', '🥈 מקום 2'] }));
    expect(html.match(/class="hc"/g)).toHaveLength(2);
    expect(html.match(/class="sep"/g)).toHaveLength(1);
    expect(html).toContain('<bdi dir="ltr">10</bdi> × <bdi dir="ltr">1.6</bdi> ק״מ ביעד');
    expect(html).toContain('🥈 מקום <bdi dir="ltr">2</bdi>');
  });
});
