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

/** Routes structured run-chat attachments while retaining Stream's native files/images. */
export function RunChatAttachment(props: AttachmentProps) {
  const attachments = props.attachments as Array<Record<string, unknown>>;
  const custom = attachments.filter((attachment) =>
    ['workout', 'strava_run', 'tool_trace'].includes(String(attachment.type)),
  );
  const native = props.attachments.filter((attachment) =>
    !('type' in attachment) ||
    !['workout', 'strava_run', 'tool_trace'].includes(String(attachment.type)),
  );

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
