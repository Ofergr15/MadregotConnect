import { describe, expect, it } from 'vitest';
import { groupByPush, shownRate, silentPeople, stateOf, tally, type DeliveryRow } from '@/lib/push-deliveries';

/** Did the push SHOW (Ofer 10-23): the states, the tally, the dead-phone rule. */
const NOW = Date.parse('2026-10-23T10:00:00Z');
const row = (o: Partial<DeliveryRow>): DeliveryRow => ({
  id: Math.random().toString(), nid: 'n1', athlete_id: 'a', subscription_id: 's', kind: 'k', title: 't',
  sent_at: '2026-10-23T09:00:00Z', accepted: true, error: null, shown_at: null, ...o,
});

describe('push delivery states', () => {
  it('shown / waiting / not shown / refused / no device / muted', () => {
    expect(stateOf(row({ shown_at: '2026-10-23T09:00:05Z' }), NOW)).toBe('shown');
    expect(stateOf(row({ sent_at: '2026-10-23T09:55:00Z' }), NOW)).toBe('waiting');
    expect(stateOf(row({}), NOW)).toBe('not_shown');
    expect(stateOf(row({ accepted: false, error: '403' }), NOW)).toBe('refused');
    expect(stateOf(row({ accepted: false, error: 'no-device', subscription_id: null }), NOW)).toBe('no_device');
    expect(stateOf(row({ accepted: false, error: 'muted' }), NOW)).toBe('muted');
  });
  it('the rate counts what could be judged, not the waiting or the muted', () => {
    const t = tally([row({ shown_at: 'x' }), row({ shown_at: 'x' }), row({}), row({ sent_at: '2026-10-23T09:58:00Z' }), row({ accepted: false, error: 'muted' })], NOW);
    expect([t.sent, t.shown, t.notShown, t.waiting, t.muted]).toEqual([4, 2, 1, 1, 1]);
    expect(shownRate(t)).toBe(67);
  });
  it('one push is one group, whatever devices it went to', () => {
    const g = groupByPush([row({ subscription_id: 's1', shown_at: 'x' }), row({ subscription_id: 's2', athlete_id: 'b' })], NOW);
    expect(g).toHaveLength(1);
    expect([g[0].people, g[0].tally.shown, g[0].tally.notShown]).toEqual([2, 1, 1]);
  });
  it('a dead phone: three unshown and nothing shown — one shown push clears it', () => {
    const dead = [1, 2, 3].map((i) => row({ nid: `n${i}`, athlete_id: 'x' }));
    expect(silentPeople(dead, 3, NOW)).toEqual([{ athleteId: 'x', unshown: 3 }]);
    expect(silentPeople([...dead, row({ nid: 'n4', athlete_id: 'x', shown_at: 'y' })], 3, NOW)).toEqual([]);
  });
});
