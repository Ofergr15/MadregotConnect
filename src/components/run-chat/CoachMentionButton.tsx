'use client';

import { UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Channel as StreamChannel } from 'stream-chat';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export type MentionableCoach = {
  id: string;
  name: string;
  image?: string | null;
};

export function CoachMentionButton({
  channel,
  coach,
  className,
}: {
  channel: StreamChannel;
  coach: MentionableCoach;
  className?: string;
}) {
  const t = useTranslations('runChat');

  const handleClick = async () => {
    const composer = channel.messageComposer?.textComposer;
    if (!composer) return;
    const prefix = !composer.text || composer.text.endsWith(' ') ? '' : ' ';
    await composer.insertText({ text: `${prefix}@${coach.name} ` });
    composer.upsertMentionEntity({
      id: coach.id,
      mentionType: 'user',
      name: coach.name,
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
            aria-label={t('tagCoach')}
          >
            <Avatar className="h-full w-full">
              {coach.image && <AvatarImage src={coach.image} alt={coach.name} />}
              <AvatarFallback>
                <UserRound className="h-4 w-4" />
              </AvatarFallback>
            </Avatar>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('tagCoach')}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
