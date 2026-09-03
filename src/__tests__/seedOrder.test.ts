import { describe, expect, it } from 'vitest';
import { orderSeedMessagesFirst, seedKindOf } from '@/lib/run-chat/seed-order';

const ai = (text: string, extra: Record<string, unknown> = {}) => ({
  user: { id: 'aicoach' },
  text,
  ...extra,
});
const runner = (text: string) => ({ user: { id: 'runner-1' }, text });

describe('seedKindOf', () => {
  it('recognises seeds by custom field or text', () => {
    expect(seedKindOf(ai('x', { run_chat_seed: 'plan' }))).toBe('plan');
    expect(seedKindOf(ai('🏃 מה רצנו בפועל'))).toBe('actuals');
    expect(seedKindOf(ai('📋 תוכנית האימון להיום:\n5x1000'))).toBe('plan');
    expect(seedKindOf(ai('האימון היום היה טוב'))).toBeNull();
    expect(seedKindOf(runner('🏃 מה רצנו בפועל'))).toBeNull();
  });
});

describe('orderSeedMessagesFirst', () => {
  it('moves a late actuals card directly under the program', () => {
    const plan = ai('📋 תוכנית האימון להיום:\nקל');
    const question = runner('@aicoach איך היה?');
    const answer = ai('היה מצוין');
    const actuals = ai('🏃 מה רצנו בפועל', { run_chat_seed: 'actuals' });

    expect(orderSeedMessagesFirst([plan, question, answer, actuals])).toEqual([
      plan,
      actuals,
      question,
      answer,
    ]);
  });

  it('returns the same array when the order is already right', () => {
    const messages = [ai('📋 תוכנית האימון להיום:\nקל'), ai('🏃 מה רצנו בפועל'), runner('hi')];
    expect(orderSeedMessagesFirst(messages)).toBe(messages);
  });

  it('leaves channels without seeds untouched', () => {
    const messages = [runner('hi'), ai('hello')];
    expect(orderSeedMessagesFirst(messages)).toBe(messages);
  });
});
