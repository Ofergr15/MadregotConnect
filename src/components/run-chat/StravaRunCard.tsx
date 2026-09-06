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
import { LapsTable } from './LapsTable';
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

function RunnerIcon() {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-[#72ef8a]">
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
        <path
          fill="currentColor"
          d="M13.5 5.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm-3.7 12 1-4.5 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.7 10 16.7 11 19 11V9c-2 0-3.7-1.1-4.6-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L5 6.5V12h2V7.8l1.8-.7-1.6 8-4.9-1-.4 2 7.9 1.4Z"
        />
      </svg>
    </span>
  );
}

export function StravaRunCard({ attachment }: { attachment: StravaRunAttachment }) {
  const t = useTranslations('runChat');
  const locale = useLocale();
  const [expanded, setExpanded] = useState(false);
  const { run } = attachment;
  if (!run) return null;
  const distanceKm = Number.isFinite(run.distance_km) ? run.distance_km : 0;
  const lapsImage = attachment.laps_image_url ? (
    <RunChatImage
      imageUrl={attachment.laps_image_url}
      alt={t('lapsPreview')}
      title={t('lapsPreview')}
      layout="full"
    />
  ) : null;
  const startTime = new Date(run.date).toLocaleTimeString(locale === 'he' ? 'he-IL' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
  const date = new Date(run.date).toLocaleDateString(locale === 'he' ? 'he-IL' : 'en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <TooltipProvider>
      <Collapsible
        open={expanded}
        onOpenChange={setExpanded}
        className="run-chat-strava-collapsible my-1 w-full max-w-[30rem]"
      >
        <Card
          className="run-chat-strava-card w-full overflow-hidden rounded-2xl border-[#294057] bg-[linear-gradient(135deg,#0c2138_0%,#07182b_100%)] text-start text-slate-100 shadow-[0_20px_50px_rgba(0,0,0,0.28)]"
        >
          <CardHeader
            dir="ltr"
            className="flex flex-row items-center gap-2.5 px-3 py-2.5"
          >
            <RunnerIcon />
            <CardTitle className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold leading-tight">
                {run.name || t('run')}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs font-medium tabular-nums text-slate-400">
                <span>{startTime}</span>
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
              </div>
            </CardTitle>

            <div className="flex shrink-0 items-center gap-2">
              {attachment.gpx_url && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button asChild variant="ghost" size="icon-sm" className="h-7 w-7 text-slate-400 hover:bg-white/5 hover:text-white">
                      <a href={attachment.gpx_url} download="activity.gpx" aria-label="GPX">
                        <Download className="h-4 w-4" />
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
                    className="h-7 w-7 text-slate-400 hover:bg-white/5 hover:text-white"
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

          <CardContent className="border-t border-[#294057]/80 px-2.5 pb-3 pt-3">
              <div dir="ltr" className="grid grid-cols-3 tabular-nums">
                <div className="text-center">
                  <strong className="block text-sm font-bold text-slate-50">
                    {distanceKm.toFixed(2)} {t('km')}
                  </strong>
                  <span className="mt-1 block text-[10px] text-slate-400">{t('distance')}</span>
                </div>
                <div className="border-x border-[#294057]/70 text-center">
                  <strong className="block text-sm font-bold text-slate-50">
                    {run.pace?.replace('/km', '') || '—'} {t('perKm')}
                  </strong>
                  <span className="mt-1 block text-[10px] text-slate-400">{t('averagePace')}</span>
                </div>
                <div className="text-center">
                  <strong className="block text-sm font-bold text-slate-50">
                    {durationText(Number(run.duration_s) || 0)}
                  </strong>
                  <span className="mt-1 block text-[10px] text-slate-400">{t('totalTime')}</span>
                </div>
              </div>

              {(run.id || attachment.laps_image_url) && (
                <div className="mt-3 w-full">
                  {run.id ? (
                    <LapsTable activityId={run.id} fallback={lapsImage} />
                  ) : (
                    lapsImage
                  )}
                </div>
              )}
          </CardContent>

          <CollapsibleContent>
            <div className="mx-5 space-y-3 border-t border-[#294057]/70 px-1 py-5 text-sm text-slate-400">
              <p>{date}</p>
              {(run.average_hr || run.elevation_gain_m != null) && (
                <div className="flex flex-wrap gap-4">
                  {run.average_hr && (
                    <span className="flex items-center gap-1.5">
                      <Heart className="h-4 w-4 text-rose-400" />
                      {Math.round(run.average_hr)} bpm
                    </span>
                  )}
                  {run.elevation_gain_m != null && (
                    <span className="flex items-center gap-1.5">
                      <Mountain className="h-4 w-4 text-emerald-400" />
                      +{run.elevation_gain_m}m
                    </span>
                  )}
                </div>
              )}
              {attachment.route_points && attachment.route_points.length > 1 && (
                <RouteMinimap points={attachment.route_points} />
              )}
            </div>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </TooltipProvider>
  );
}
