import { AI_USER_ID } from '@/lib/stream/constants';

export type SeedKind = 'plan' | 'actuals';

type SeedLikeMessage = {
  user?: { id?: string } | null;
  user_id?: string;
  text?: string | null;
  run_chat_seed?: unknown;
};

/** Identify the plan/actuals seed cards even on older messages without the custom field. */
export function seedKindOf(message: SeedLikeMessage | null | undefined): SeedKind | null {
  if (!message) return null;
  const uid = message.user?.id || message.user_id;
  if (uid !== AI_USER_ID) return null;
  if (message.run_chat_seed === 'plan' || message.run_chat_seed === 'actuals') {
    return message.run_chat_seed;
  }
  const text = message.text || '';
  if (text.startsWith('📋 תוכנית האימון להיום')) return 'plan';
  if (text.startsWith('🏃 מה רצנו בפועל')) return 'actuals';
  return null;
}

/**
 * Keep the program card first and the actual-run card right after it, even
 * when one of them was (re)created after conversation already happened.
 * Returns the same array when nothing needs to move so React can skip work.
 */
export function orderSeedMessagesFirst<T extends SeedLikeMessage>(messages: T[]): T[] {
  let plan: T | undefined;
  let actuals: T | undefined;
  for (const message of messages) {
    const kind = seedKindOf(message);
    if (kind === 'plan' && !plan) plan = message;
    else if (kind === 'actuals' && !actuals) actuals = message;
  }
  const seeds = [plan, actuals].filter((message): message is T => Boolean(message));
  if (!seeds.length) return messages;

  const alreadyFirst = seeds.every((seed, index) => messages[index] === seed);
  if (alreadyFirst) return messages;

  return [...seeds, ...messages.filter((message) => !seeds.includes(message))];
}
