'use client';

import { useState } from 'react';
import {
  ChevronDown,
  Download,
  Heart,
  Mountain,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { RouteMinimap } from '@/components/RouteMinimap';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
} from '@/components/ui/collapsible';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { StravaRunAttachment } from '@/lib/run-chat/attachments';
import { RunChatImage } from './RunChatImage';

function durationText(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = Math.round(seconds % 60);
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function StravaLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path fill="#fc4c02" d="M10.2 2 4.7 13h3.4l2.1-4.3 2.2 4.3h3.4L10.2 2Z" />
      <path fill="#fc4c02" d="m15.7 13-1.6 3.2-1.7-3.2H9.2l4.9 9 4.8-9h-3.2Z" opacity=".72" />
    </svg>
  );
}

export function StravaRunCard({ attachment }: { attachment: StravaRunAttachment }) {
  const t = useTranslations('runChat');
  const locale = useLocale();
  const [expanded, setExpanded] = useState(false);
  const { run } = attachment;
  const date = new Date(run.date).toLocaleDateString(locale === 'he' ? 'he-IL' : 'en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const startTime = new Date(run.date).toLocaleTimeString(locale === 'he' ? 'he-IL' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });

  return (
    <TooltipProvider>
      <Collapsible
        open={expanded}
        onOpenChange={setExpanded}
        className="run-chat-strava-collapsible my-1 w-[28rem] max-w-full"
      >
        <Card
          className="run-chat-strava-card w-full overflow-hidden border-blue-300/15 bg-[#193b76] text-start text-slate-100 shadow-none"
        >
          <CardHeader
            dir="ltr"
            className="flex flex-row items-center gap-2 px-3 py-2"
          >
            <CardTitle className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
              <span className="truncate">{run.name || t('run')}</span>
              <span className="text-blue-300/40">|</span>
              <span className="shrink-0 text-xs font-semibold tabular-nums text-blue-100/70">
                {startTime}
              </span>
              <span className="text-blue-300/40">|</span>
              {attachment.strava_url ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <a
                      href={attachment.strava_url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Strava"
                      className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
                    >
                      <StravaLogo />
                    </a>
                  </TooltipTrigger>
                  <TooltipContent>Strava</TooltipContent>
                </Tooltip>
              ) : (
                <StravaLogo />
              )}
            </CardTitle>

            <div className="flex shrink-0 items-center gap-0.5">
              {attachment.gpx_url && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button asChild variant="ghost" size="icon-sm" className="text-blue-200/70 hover:bg-white/10 hover:text-white">
                      <a href={attachment.gpx_url} download="activity.gpx" aria-label="GPX">
                        <Download className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>GPX</TooltipContent>
                </Tooltip>
              )}

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-blue-200/70 hover:bg-white/10 hover:text-white"
                    onClick={(event) => {
                      event.stopPropagation();
                      setExpanded((value) => !value);
                    }}
                    aria-expanded={expanded}
                    aria-label={expanded ? t('collapseDetails') : t('expandDetails')}
                  >
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {expanded ? t('collapseDetails') : t('expandDetails')}
                </TooltipContent>
              </Tooltip>
            </div>
          </CardHeader>

          <CardContent className="border-t border-blue-300/15 px-3 py-2">
            <div dir="ltr" className="flex items-baseline gap-2 text-sm tabular-nums">
              <strong>{run.distance_km.toFixed(2)} {t('km')}</strong>
              <span className="text-blue-300/40">|</span>
              <strong>{run.pace?.replace('/km', '') || '—'} {t('perKm')}</strong>
              <span className="text-blue-300/40">|</span>
              <strong>{durationText(run.duration_s)}</strong>
            </div>

            <CollapsibleContent className="space-y-3 pt-3">
              <p className="text-[11px] text-blue-100/60">{date}</p>

              {(run.average_hr || run.elevation_gain_m || run.lap_count > 0) && (
                <div className="flex flex-wrap gap-3 text-xs text-blue-100/70">
                  {run.average_hr && (
                    <span className="flex items-center gap-1">
                      <Heart className="h-3.5 w-3.5 text-rose-400" />
                      {run.average_hr} bpm
                    </span>
                  )}
                  {run.elevation_gain_m != null && (
                    <span className="flex items-center gap-1">
                      <Mountain className="h-3.5 w-3.5 text-emerald-400" />
                      +{run.elevation_gain_m}m
                    </span>
                  )}
                  {run.lap_count > 0 && <span>{t('laps', { count: run.lap_count })}</span>}
                </div>
              )}

              {attachment.route_points && attachment.route_points.length > 1 && (
                <RouteMinimap points={attachment.route_points} />
              )}

              {attachment.laps_image_url && (
                <div className="w-full">
                  <RunChatImage
                    imageUrl={attachment.laps_image_url}
                    alt={t('lapsPreview')}
                    title={t('lapsPreview')}
                    layout="full"
                  />
                </div>
              )}
            </CollapsibleContent>
          </CardContent>
        </Card>
      </Collapsible>
    </TooltipProvider>
  );
}
