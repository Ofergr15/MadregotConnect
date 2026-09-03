import { afterEach, describe, expect, it } from 'vitest';
import { resolveCoachProvider } from '@/lib/run-chat/ai-complete';

describe('resolveCoachProvider', () => {
  const previousOpenAi = process.env.OPENAI_API_KEY;
  const previousAnthropic = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    if (previousOpenAi === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAi;
    if (previousAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousAnthropic;
  });

  it('prefers OpenAI when that key is set', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.ANTHROPIC_API_KEY = 'ant-test';
    expect(resolveCoachProvider()).toBe('openai');
  });

  it('falls back to Anthropic', () => {
    delete process.env.OPENAI_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'ant-test';
    expect(resolveCoachProvider()).toBe('anthropic');
  });

  it('throws when neither key is configured', () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => resolveCoachProvider()).toThrow(/OPENAI_API_KEY or ANTHROPIC_API_KEY/);
  });
});
