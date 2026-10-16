import { describe, it, expect } from 'vitest';
import { placeCandidate, PARKED_STAGES, STAGES } from '@/lib/academy/funnel';

const NOW = '2026-10-16T09:00:00+03:00';
const row = { id: 'c1', name: 'Noa', createdAt: '2026-09-01T09:00:00+03:00' } as never;
const ev = (stage: string, occurredAt: string) => ({ candidateId: 'c1', stage, occurredAt }) as never;

describe('parked funnel stages (WhatsApp groups, standing order)', () => {
  it('are WhatsApp and the standing order', () => {
    expect([...PARKED_STAGES].sort()).toEqual(['standing_order', 'whatsapp']);
  });

  it('a candidate who finished every working stage is joined, not waiting for WhatsApp', () => {
    const working = STAGES.filter(s => !PARKED_STAGES.has(s.key));
    const events = working.map((s, i) => ev(s.key, `2026-09-${String(2 + i).padStart(2, '0')}T09:00:00+03:00`));
    const placed = placeCandidate(row, events, NOW);
    expect(placed.status).toBe('joined');
    expect(placed.waitingFor).toBeNull();
    expect(placed.stuck).toBe(false);
  });

  it('a candidate is never waiting for, or stuck on, a parked stage', () => {
    const upToPlan = ['form', 'intro_call', 'characterization', 'signup', 'test', 'analysis'];
    const placed = placeCandidate(row, upToPlan.map((k, i) => ev(k, `2026-09-0${2 + i}T09:00:00+03:00`)), NOW);
    expect(placed.waitingFor).toBe('first_plan');
    expect(PARKED_STAGES.has(placed.waitingFor as string)).toBe(false);
  });
});
