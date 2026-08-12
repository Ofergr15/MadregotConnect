'use client';

import { MessageUI, useMessageContext } from 'stream-chat-react';
import { RunChatAvatar } from '@/components/run-chat/RunChatAvatar';

/**
 * Own the avatar | (name + bubble) layout. Stream's built-in avatar grid
 * fights RTL and parks avatars on the timestamp row — so we hide it and
 * render our own avatar aligned to the top of the bubble column.
 */
export function RunChatMessageUI() {
  const { message, isMyMessage } = useMessageContext('RunChatMessageUI');
  const name = message.user?.name || message.user?.id || '';
  const mine = typeof isMyMessage === 'function' ? isMyMessage() : !!isMyMessage;
  const imageUrl = typeof message.user?.image === 'string' ? message.user.image : undefined;
  const toolOnly =
    !(message.text || '').trim() &&
    (message.attachments || []).some(
      (attachment) => 'type' in attachment && attachment.type === 'tool_trace',
    );

  if (toolOnly) {
    return (
      <div className="run-chat-tool-event">
        <MessageUI />
      </div>
    );
  }

  return (
    <div className={mine ? 'run-chat-msg run-chat-msg--me' : 'run-chat-msg run-chat-msg--other'}>
      <div className="run-chat-msg__avatar">
        <RunChatAvatar
          imageUrl={imageUrl}
          userName={name}
          size="md"
        />
      </div>
      <div className="run-chat-msg__main">
        {name && (
          <div className="run-chat-msg__name">
            {name}
            {mine ? ' (אני)' : ''}
          </div>
        )}
        <MessageUI />
      </div>
    </div>
  );
}
