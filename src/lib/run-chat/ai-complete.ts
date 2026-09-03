/**
 * Run-chat model turn. OpenAI is preferred when OPENAI_API_KEY is set
 * (better Hebrew), otherwise Claude.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import OpenAI from 'openai';
import { z } from 'zod';

const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-sol';

export type CoachChatMessage = { role: 'user' | 'assistant'; content: string };

export type CoachTool = {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: (args: any) => Promise<string>;
};

export function resolveCoachProvider(): 'openai' | 'anthropic' {
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  throw new Error('OPENAI_API_KEY or ANTHROPIC_API_KEY is not configured');
}

function toolJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const toJson = (z as unknown as { toJSONSchema?: (value: z.ZodType) => Record<string, unknown> })
    .toJSONSchema;
  if (typeof toJson === 'function') {
    const json = toJson(schema);
    delete json.$schema;
    return json;
  }
  return { type: 'object', properties: {} };
}

async function completeWithOpenAI(opts: {
  system: string;
  messages: CoachChatMessage[];
  tools: CoachTool[];
}): Promise<string> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const toolsByName = new Map(opts.tools.map((tool) => [tool.name, tool]));
  const openaiTools: OpenAI.Chat.ChatCompletionTool[] = opts.tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: toolJsonSchema(tool.inputSchema),
    },
  }));

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: opts.system },
    ...opts.messages,
  ];

  for (let i = 0; i < 5; i++) {
    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      tools: openaiTools,
      tool_choice: 'auto',
      // GPT-5.4+ rejects tools + default reasoning on chat/completions.
      ...(OPENAI_MODEL.startsWith('gpt-5.') ? { reasoning_effort: 'none' as const } : {}),
    });
    const message = response.choices[0]?.message;
    if (!message) return '';
    messages.push(message);

    if (!message.tool_calls?.length) {
      return (message.content || '').trim();
    }

    for (const call of message.tool_calls) {
      if (call.type !== 'function') continue;
      const tool = toolsByName.get(call.function.name);
      let result: string;
      try {
        const args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
        result = tool ? await tool.run(args) : `Unknown tool: ${call.function.name}`;
      } catch (error) {
        result = error instanceof Error ? error.message : String(error);
      }
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: result,
      });
    }
  }

  return '';
}

async function completeWithAnthropic(opts: {
  system: string;
  messages: CoachChatMessage[];
  tools: CoachTool[];
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');
  const anthropic = new Anthropic({ apiKey });
  const finalMsg = await anthropic.beta.messages.toolRunner({
    model: ANTHROPIC_MODEL,
    max_tokens: 2048,
    system: opts.system,
    tools: opts.tools.map((tool) =>
      betaZodTool({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        run: (args: unknown) => tool.run((args || {}) as Record<string, unknown>),
      }),
    ),
    messages: opts.messages,
    max_iterations: 5,
  });
  return finalMsg.content
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}

export async function completeCoachTurn(opts: {
  system: string;
  messages: CoachChatMessage[];
  tools: CoachTool[];
}): Promise<string> {
  const provider = resolveCoachProvider();
  return provider === 'openai' ? completeWithOpenAI(opts) : completeWithAnthropic(opts);
}
