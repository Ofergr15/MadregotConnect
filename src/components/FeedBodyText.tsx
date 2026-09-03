'use client';

import Link from 'next/link';
import { renderMentionSegments } from '@/lib/feed/mentions';

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
          <Link
            key={i}
            href={`/dashboard/teammate/${seg.athleteId}`}
            className="font-semibold text-brand-600 hover:underline"
            dir="auto"
          >
            @{seg.name}
          </Link>
        ) : (
          <span key={i}>{seg.content}</span>
        ),
      )}
    </>
  );
}
