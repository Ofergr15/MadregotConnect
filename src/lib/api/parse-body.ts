import { NextResponse } from 'next/server';
import type { z } from 'zod';

export type ParsedBody<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

function invalid(details: string[]): { ok: false; response: NextResponse } {
  return {
    ok: false,
    response: NextResponse.json({ error: 'Invalid body', details }, { status: 400 }),
  };
}

/**
 * Read a JSON request body and check it against a zod schema.
 *
 * Non-JSON bodies and schema failures both become a 400
 * `{ error: 'Invalid body', details }`. `details` lists the offending field
 * paths with zod's message only; submitted values are never echoed back.
 * Call it after the auth gate (when auth doesn't need the body) and before
 * any DB work.
 */
export async function parseJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<ParsedBody<z.infer<S>>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return invalid(['body: not valid JSON']);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .slice(0, 10)
      .map((i) => `${i.path.length ? i.path.join('.') : 'body'}: ${i.code}`);
    return invalid(details);
  }
  return { ok: true, data: result.data };
}
