'use client';

import { cn } from '@/lib/utils';
import type { Channel as StreamChannel } from 'stream-chat';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { AI_USER_ID } from '@/lib/stream/constants';

interface Props {
  channel: StreamChannel;
  className?: string;
}

/**
 * Inserts a real Stream mention for aicoach into the channel MessageComposer
 * (DOM textarea hacks don't update Stream's textComposer state).
 */
export function AiMentionButton({ channel, className }: Props) {
  const handleClick = async () => {
    const tc = channel.messageComposer?.textComposer;
    if (!tc) return;

    const text = tc.text || '';
    const prefix = text === '' || text.endsWith(' ') ? '' : ' ';
    const mentionText = `${prefix}@aicoach `;

    await tc.insertText({ text: mentionText });
    tc.upsertMentionEntity({
      id: AI_USER_ID,
      mentionType: 'user',
      name: 'מאמן AI',
    });
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => void handleClick()}
            className={cn('h-9 w-9 shrink-0 rounded-full border-slate-700 bg-slate-950 p-0 hover:border-primary-500', className)}
            aria-label="שאל את מאמן ה-AI"
          >
            <Avatar className="h-full w-full bg-transparent">
              <AvatarImage src="/aicoach.png" alt="מאמן AI" className="object-contain" />
              <AvatarFallback>AI</AvatarFallback>
            </Avatar>
          </Button>
        </TooltipTrigger>
        <TooltipContent>שאל את מאמן ה-AI</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
