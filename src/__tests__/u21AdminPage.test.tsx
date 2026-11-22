// @vitest-environment happy-dom
/**
 * /u21/admin — the read-only registrations list. The route limits the columns
 * (U21_LIST_COLUMNS); the page must render only those, show a red flag as an
 * attention mark and never as a decision, and say plainly which state it is in
 * (loading, refused, table missing, empty, rows). Synthetic data, no network.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ state: {} as { data?: unknown; error?: unknown; isLoading?: boolean } }));
vi.mock('@/lib/api', () => ({ useApi: () => h.state }));

const { default: U21AdminPage } = await import('@/app/u21/admin/page');
const { U21_LIST_COLUMNS } = await import('@/app/api/u21/registrations/route');

afterEach(() => { cleanup(); h.state = {}; });

const row = (over: Record<string, unknown> = {}) => ({
  id: 'r1', first_name: 'Test', last_name: 'Fixture', age_band: '16-17', track: 'basic',
  red_flag: false, status: 'pending_review', created_at: '2026-11-20T08:00:00Z', ...over,
});

describe('U21 admin list page', () => {
  it('loading', () => {
    h.state = { isLoading: true };
    expect(render(<U21AdminPage />).container.textContent).toContain('טוען');
  });

  it('refused or failed: says admin sign-in is needed, shows no table', () => {
    h.state = { error: new Error('403') };
    const { container } = render(<U21AdminPage />);
    expect(container.textContent).toContain('נדרשת התחברות כמנהל');
    expect(container.querySelector('table')).toBeNull();
  });

  it('table not migrated: names migration 199, shows no table', () => {
    h.state = { data: { data: [], ready: false } };
    const { container } = render(<U21AdminPage />);
    expect(container.textContent).toContain('מיגרציה 180');
    expect(container.querySelector('table')).toBeNull();
  });

  it('empty', () => {
    h.state = { data: { data: [], ready: true } };
    expect(render(<U21AdminPage />).container.textContent).toContain('אין הרשמות עדיין');
  });

  it('rows: only the listed columns, the flag as a badge only', () => {
    // Extra fields a mistaken route might send must not reach the screen.
    const leaked = { email: 'leak@example.test', phone: '0500000000', guardian_phone: '0511111111', answers: { chestPain: 'yes' }, birth_date: '2009-01-01' };
    h.state = { data: { data: [row(), row({ id: 'r2', first_name: 'Flag', red_flag: true, ...leaked })], ready: true } };
    const { container } = render(<U21AdminPage />);
    const text = container.textContent || '';
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    for (const v of Object.values(leaked).flatMap(v => (typeof v === 'object' ? Object.values(v) : [v]))) {
      expect(text).not.toContain(String(v));
    }
    expect(text).not.toContain('chestPain');
    const cells = (i: number) => [...container.querySelectorAll('tbody tr')[i].querySelectorAll('td')];
    expect(cells(0)[3].innerHTML).toBe('');          // no flag → empty attention cell
    expect(cells(1)[3].innerHTML).not.toBe('');      // flag → a mark, not a reason
    expect(cells(1)[3].textContent).not.toMatch(/chest|faint|bone|injury|חזה|התעלפ|עצם|פציעה/i);
    expect(cells(0)[2].textContent).toBe('BASIC');   // track name, no price
    expect(text).not.toMatch(/₪|\b79\b|\b119\b|\b219\b/);
  });

  it('the page reads only the columns the route allows', () => {
    const allowed = U21_LIST_COLUMNS.split(',').map(s => s.trim());
    expect(allowed).toEqual(['id', 'first_name', 'last_name', 'age_band', 'track', 'red_flag', 'status', 'created_at']);
  });
});
