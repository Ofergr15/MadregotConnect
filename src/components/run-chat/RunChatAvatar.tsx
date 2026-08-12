'use client';

import type { ChannelAvatarProps } from 'stream-chat-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { AI_USER_ID } from '@/lib/stream/constants';

function initialsOf(name: string): string {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function isAiAvatar(imageUrl?: string, userName?: string): boolean {
  if (imageUrl?.includes('aicoach.png')) return true;
  if (userName?.includes('מאמן AI')) return true;
  return false;
}

function GoogleUserIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="12" cy="12" r="12" fill="#4285F4" />
      <circle cx="12" cy="9.2" r="3.4" fill="#fff" />
      <path
        fill="#fff"
        d="M5.2 19.2c1.6-2.4 4-3.6 6.8-3.6s5.2 1.2 6.8 3.6A11.9 11.9 0 0 1 12 24a11.9 11.9 0 0 1-6.8-4.8z"
      />
    </svg>
  );
}

/**
 * Keeps Stream's size class + grid-area so the avatar lines up with the bubble.
 * Hover scales a transform-only layer (slot size stays fixed → no message dance).
 */
export function RunChatAvatar({
  imageUrl,
  userName,
  initials: customInitials,
  className,
  size = 'md',
}: ChannelAvatarProps) {
  const ai = isAiAvatar(imageUrl, userName);
  const initials = customInitials || initialsOf(userName || '');
  const sizeClass = size ? `str-chat__avatar--size-${size}` : 'str-chat__avatar--size-md';

  return (
    <div
      className={cn(
        'str-chat__avatar str-chat__avatar--with-border run-chat-avatar',
        sizeClass,
        ai && 'run-chat-avatar--ai',
        className,
      )}
      data-user={ai ? AI_USER_ID : undefined}
    >
      <Avatar className="run-chat-avatar__face">
        {imageUrl && (
          <AvatarImage
            src={imageUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="run-chat-avatar__img str-chat__avatar-image"
          />
        )}
        <AvatarFallback className="run-chat-avatar__fallback" aria-hidden>
          {ai ? (
            <span className="run-chat-avatar__initials">{initials || 'AI'}</span>
          ) : (
            <GoogleUserIcon className="run-chat-avatar__google" />
          )}
        </AvatarFallback>
      </Avatar>
    </div>
  );
}
