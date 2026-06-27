import Anthropic from '@anthropic-ai/sdk';
import { ParsedWeeklyPlan } from './types';
import { WORKOUT_PARSER_SYSTEM_PROMPT } from './prompt';

function getAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set in environment variables');
  }
  return new Anthropic({ apiKey });
}

export async function parseWorkoutPlan(input: {
  text?: string;
  imageBase64?: string;
  imageMediaType?: string;
}): Promise<ParsedWeeklyPlan> {
  const content: Anthropic.MessageCreateParams['messages'][0]['content'] = [];

  if (input.imageBase64 && input.imageMediaType) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: input.imageMediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
        data: input.imageBase64,
      },
    });
    content.push({
      type: 'text',
      text: input.text
        ? `Parse this training plan image. Additional context: ${input.text}`
        : 'Parse this training plan image into structured workouts.',
    });
  } else if (input.text) {
    content.push({
      type: 'text',
      text: `Parse this training plan into structured workouts:\n\n${input.text}`,
    });
  } else {
    throw new Error('Either text or image must be provided');
  }

  const anthropic = getAnthropicClient();
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6-20250514',
    max_tokens: 4096,
    system: WORKOUT_PARSER_SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from AI');
  }

  let jsonText = textBlock.text.trim();
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const parsed: ParsedWeeklyPlan = JSON.parse(jsonText);

  if (!parsed.workouts || !Array.isArray(parsed.workouts)) {
    throw new Error('Invalid response structure: missing workouts array');
  }

  return parsed;
}
