import Anthropic from '@anthropic-ai/sdk';
import { ParsedWeeklyPlan, ParsedWorkout, WorkoutStep } from './types';
import { WORKOUT_PARSER_SYSTEM_PROMPT } from './prompt';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function parseWithClaude(content: Anthropic.MessageCreateParams['messages'][0]['content'], useVision = false): Promise<ParsedWeeklyPlan> {
  const response = await anthropic.messages.create({
    model: useVision ? 'claude-sonnet-4-6-20250514' : 'claude-haiku-4-5-20251001',
    max_tokens: 4000,
    system: WORKOUT_PARSER_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content,
      },
    ],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (!parsed.workouts || !Array.isArray(parsed.workouts)) {
      throw new Error('Invalid response structure');
    }
    return parsed as ParsedWeeklyPlan;
  } catch (e) {
    throw new Error(`Failed to parse Claude response as JSON: ${cleaned.slice(0, 200)}`);
  }
}

export async function parseWorkoutPlan(input: {
  text?: string;
  imageBase64?: string;
  imageMediaType?: string;
}): Promise<ParsedWeeklyPlan> {
  if (input.imageBase64 && input.imageMediaType) {
    const isPdf = input.imageMediaType === 'application/pdf';
    const content: Anthropic.MessageCreateParams['messages'][0]['content'] = [];

    if (isPdf) {
      content.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: input.imageBase64,
        },
      } as any);
    } else {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: input.imageMediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: input.imageBase64,
        },
      });
    }

    content.push({
      type: 'text',
      text: input.text
        ? `Here is the training plan document/image. Also, the coach provided this text:\n\n${input.text}\n\nParse all workouts from both the document and the text.`
        : 'Parse this training plan into structured workouts. Extract every day and every workout detail.',
    });

    return parseWithClaude(content, true);
  }

  if (input.text?.trim()) {
    const content: Anthropic.MessageCreateParams['messages'][0]['content'] = [
      {
        type: 'text',
        text: `Parse this training plan:\n\n${input.text}`,
      },
    ];

    return parseWithClaude(content, false);
  }

  throw new Error('Either text or image must be provided');
}
