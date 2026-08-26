// Mentions are embedded directly in a post/comment's plain-text body as
// `@[Name](athleteId)` — no schema change needed (body is already a TEXT
// column on both feed_items and feed_comments), and no name-matching
// ambiguity at render/notify time (two athletes can share a name; the id in
// the token is what actually resolves who's tagged). The composer inserts
// this exact token when someone is picked from the @-autocomplete; nothing
// else should ever produce or expect a different shape.
const MENTION_RE = /@\[([^\]]+)\]\(([0-9a-f-]{36})\)/gi;

export interface ParsedMention {
  athleteId: string;
  name: string;
  /** The exact matched token, e.g. "@[Tal Boren](uuid)" — for splitting. */
  raw: string;
}

/** Extracts every mention token from a body, in order of appearance. */
export function parseMentions(body: string): ParsedMention[] {
  const mentions: ParsedMention[] = [];
  for (const match of body.matchAll(MENTION_RE)) {
    mentions.push({ name: match[1], athleteId: match[2], raw: match[0] });
  }
  return mentions;
}

export type BodySegment = { type: 'text'; content: string } | { type: 'mention'; name: string; athleteId: string };

/**
 * Splits a body into renderable segments — plain text runs and mention
 * runs — so a component can render `@Name` as a link without doing its own
 * regex work. Adjacent/empty text runs are dropped so `.map()` never
 * renders an empty `<span/>`.
 */
export function renderMentionSegments(body: string): BodySegment[] {
  const segments: BodySegment[] = [];
  let lastIndex = 0;
  for (const match of body.matchAll(MENTION_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) segments.push({ type: 'text', content: body.slice(lastIndex, index) });
    segments.push({ type: 'mention', name: match[1], athleteId: match[2] });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < body.length) segments.push({ type: 'text', content: body.slice(lastIndex) });
  return segments;
}

/**
 * Athlete ids to notify for a new post/comment body — every uniquely
 * mentioned athlete, minus the author themself (tagging yourself, or being
 * tagged twice in one body, shouldn't produce a push at all / more than
 * once).
 */
export function uniqueMentionedAthleteIds(body: string, authorAthleteId: string): string[] {
  const ids = new Set(parseMentions(body).map((m) => m.athleteId));
  ids.delete(authorAthleteId);
  return [...ids];
}

/** Builds the `@[Name](id)` token the composer inserts when a mention is picked. */
export function mentionToken(name: string, athleteId: string): string {
  return `@[${name}](${athleteId})`;
}
