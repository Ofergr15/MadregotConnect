'use client';

import {
  Attachment as DefaultAttachment,
  type AttachmentProps,
} from 'stream-chat-react';
import { RunChatImage } from './RunChatImage';
import { StravaRunCard } from './StravaRunCard';
import { ToolTraceCard } from './ToolTraceCard';
import { WorkoutCard } from './WorkoutCard';
import type {
  StravaRunAttachment as StravaRunAttachmentData,
  ToolTraceAttachment,
} from '@/lib/run-chat/attachments';
import type { PlannedWorkout } from '@/lib/run-chat/mock-workout';
import { toFileRoute } from '@/lib/storage/buckets';

// Messages already in Stream still carry the bucket's public link, which stops loading once
// run-chat is private (migration 252): read them through /api/files like everything else.
const LINK_KEYS = ['image_url', 'asset_url', 'thumb_url', 'laps_image_url'] as const;
function withFileRoutes<T extends object>(attachment: T): T {
  const a = attachment as Record<string, unknown>;
  if (!LINK_KEYS.some((k) => typeof a[k] === 'string')) return attachment;
  const out: Record<string, unknown> = { ...a };
  for (const k of LINK_KEYS) if (typeof out[k] === 'string') out[k] = toFileRoute(out[k] as string);
  return out as T;
}

/** Routes structured run-chat attachments while retaining Stream's native files/images. */
export function RunChatAttachment(incoming: AttachmentProps) {
  const props = { ...incoming, attachments: incoming.attachments.map(withFileRoutes) };
  const attachments = props.attachments as Array<Record<string, unknown>>;
  const custom = attachments.filter((attachment) =>
    ['workout', 'strava_run', 'tool_trace'].includes(String(attachment.type)),
  );
  // Run cards render their own laps image; drop native copies of the same URL.
  const cardImageUrls = new Set(
    custom
      .filter((attachment) => attachment.type === 'strava_run')
      .map((attachment) => String(attachment.laps_image_url || ''))
      .filter(Boolean),
  );
  const native = props.attachments.filter((attachment) => {
    if (!('type' in attachment)) return true;
    if (['workout', 'strava_run', 'tool_trace'].includes(String(attachment.type))) return false;
    const url = String(
      (attachment as { image_url?: string; asset_url?: string }).image_url ||
        (attachment as { asset_url?: string }).asset_url ||
        '',
    );
    return !(attachment.type === 'image' && url && cardImageUrls.has(url));
  });

  return (
    <div className="run-chat-attachments my-1 space-y-2">
      {custom.map((attachment, index) => {
        if (attachment.type === 'strava_run') {
          return (
            <StravaRunCard
              key={`strava-${index}`}
              attachment={attachment as unknown as StravaRunAttachmentData}
            />
          );
        }
        if (attachment.type === 'tool_trace') {
          return (
            <ToolTraceCard
              key={`tools-${index}`}
              attachment={attachment as unknown as ToolTraceAttachment}
            />
          );
        }
        const workout = attachment.workout as PlannedWorkout | undefined;
        return (
          <WorkoutCard
            key={`workout-${index}`}
            plannedText={typeof attachment.text === 'string' ? attachment.text : null}
            plannedWorkout={workout || null}
          />
        );
      })}
      {native.length > 0 && (
        <DefaultAttachment {...props} attachments={native} Image={RunChatImage} />
      )}
    </div>
  );
}
