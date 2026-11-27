/**
 * What a 500 tells the caller. CLAUDE.md API conventions return `{ error: string }`; a
 * catch-all that did `String(err)` returned "[object Object]" for a thrown PostgrestError
 * and, for SDK errors (Stream, Rekognition, Drive), their full text — which can name
 * member ids or emails ("users … don't exist: [uuid, …]"). The real error goes to the
 * server log; the response carries a fixed message.
 */
export function internalErrorBody(fallback = 'Internal error'): { error: string } {
  return { error: fallback };
}
