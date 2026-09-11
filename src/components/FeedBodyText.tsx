'use client';

import { renderMentionSegments } from '@/lib/feed/mentions';
import { AthleteLink } from '@/components/AthleteLink';

/**
 * Renders a post/comment body, turning any `@[Name](athleteId)` mention
 * tokens into real links to that athlete's profile instead of showing the
 * raw token text. Plain bodies with no mentions render unchanged.
 */
export function FeedBodyText({ body }: { body: string }) {
  const segments = renderMentionSegments(body);
  return (
    <>
      {segments.map((seg, i) =>
        seg.type === 'mention' ? (
          <AthleteLink
            key={i}
            athleteId={seg.athleteId}
            name={seg.name}
            className="font-semibold text-brand-600 hover:underline"
          >
            <span dir="auto">@{seg.name}</span>
          </AthleteLink>
        ) : (
          <span key={i}>{seg.content}</span>
        ),
      )}
    </>
  );
}
