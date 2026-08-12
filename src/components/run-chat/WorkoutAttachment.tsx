'use client';

import {
  Attachment as DefaultAttachment,
  type AttachmentProps,
} from 'stream-chat-react';
import { WorkoutCard } from './WorkoutCard';

type WorkoutPayload = {
  title?: string;
  prompt?: string;
  segments?: Array<Record<string, unknown>>;
};

/**
 * Renders Stream's native image/file attachments, plus our custom `workout` type.
 */
export function WorkoutAttachment(props: AttachmentProps) {
  const { attachments } = props;
  const workoutAtt = attachments.find((a) => 'type' in a && a.type === 'workout');
  const rest = attachments.filter((a) => !('type' in a) || a.type !== 'workout');

  const workout = workoutAtt && 'type' in workoutAtt
    ? (workoutAtt as { type: string; text?: string; title?: string; workout?: WorkoutPayload })
    : null;

  return (
    <div className="space-y-2 my-1">
      {workout && (
        <WorkoutCard
          plannedText={workout.text || null}
          plannedWorkout={
            workout.workout
              ? {
                  title: workout.workout.title || workout.title,
                  prompt: workout.workout.prompt || workout.text,
                  segments: (workout.workout.segments || []) as any,
                }
              : {
                  title: workout.title || 'תוכנית אימון',
                  prompt: workout.text || undefined,
                  segments: [],
                }
          }
        />
      )}
      {rest.length > 0 && <DefaultAttachment {...props} attachments={rest} />}
    </div>
  );
}
