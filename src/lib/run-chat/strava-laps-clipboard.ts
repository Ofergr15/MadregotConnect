/**
 * Render a Strava-mobile-style laps card as PNG for run-chat actuals.
 */

import sharp from 'sharp';
import { formatDuration, formatPace, type StravaLap } from '@/lib/strava/client';

export const LAPS_CLIPBOARD_VERSION = 'v2';

const ORANGE = '#FC4C02';
const TEXT = '#F8FAFC';
const MUTED = '#AFC4E8';
const BG = '#0B1830';
const ROW = '#142F63';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function renderStravaLapsPng(opts: {
  title: string;
  distanceM?: number | null;
  durationSec?: number | null;
  laps: StravaLap[];
}): Promise<Buffer> {
  const width = 390;
  const padX = 16;
  const headerH = 72;
  const rowH = 44;
  const laps = opts.laps.slice(0, 40);
  const height = headerH + laps.length * rowH + 28;

  const rows = laps
    .map((lap, i) => {
      const y = headerH + i * rowH;
      const bg = i % 2 === 0 ? ROW : BG;
      const dist =
        lap.distance >= 1000
          ? `${(lap.distance / 1000).toFixed(2)} km`
          : `${Math.round(lap.distance)} m`;
      const pace = formatPace(lap.average_speed);
      const time = formatDuration(lap.moving_time);
      const hr = lap.average_heartrate ? `${Math.round(lap.average_heartrate)}` : '—';
      return `
        <rect x="0" y="${y}" width="${width}" height="${rowH}" fill="${bg}"/>
        <text x="${padX}" y="${y + 28}" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="${TEXT}">${i + 1}</text>
        <text x="${padX + 36}" y="${y + 28}" font-family="Arial, sans-serif" font-size="13" font-weight="600" fill="${TEXT}">${escapeXml(dist)}</text>
        <text x="${padX + 130}" y="${y + 28}" font-family="Arial, sans-serif" font-size="13" fill="${TEXT}">${escapeXml(time)}</text>
        <text x="${padX + 210}" y="${y + 28}" font-family="Arial, sans-serif" font-size="13" fill="${TEXT}">${escapeXml(pace)}</text>
        <text x="${padX + 290}" y="${y + 28}" font-family="Arial, sans-serif" font-size="13" fill="${MUTED}">${escapeXml(hr)}</text>
      `;
    })
    .join('\n');

  const summaryDist =
    opts.distanceM != null
      ? opts.distanceM >= 1000
        ? `${(opts.distanceM / 1000).toFixed(2)} km`
        : `${Math.round(opts.distanceM)} m`
      : '';
  const summaryTime = opts.durationSec != null ? formatDuration(opts.durationSec) : '';

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" rx="12" fill="${BG}"/>
  <rect x="0" y="0" width="6" height="${height}" fill="${ORANGE}"/>
  <text x="${padX + 8}" y="28" font-family="Arial, sans-serif" font-size="16" font-weight="700" fill="${TEXT}">${escapeXml(opts.title)}</text>
  <text x="${padX + 8}" y="50" font-family="Arial, sans-serif" font-size="12" fill="${MUTED}">${escapeXml([summaryDist, summaryTime, `${laps.length} laps`].filter(Boolean).join(' · '))}</text>
  <text x="${padX}" y="${headerH - 6}" font-family="Arial, sans-serif" font-size="10" font-weight="700" fill="${MUTED}">#</text>
  <text x="${padX + 36}" y="${headerH - 6}" font-family="Arial, sans-serif" font-size="10" font-weight="700" fill="${MUTED}">DIST</text>
  <text x="${padX + 130}" y="${headerH - 6}" font-family="Arial, sans-serif" font-size="10" font-weight="700" fill="${MUTED}">TIME</text>
  <text x="${padX + 210}" y="${headerH - 6}" font-family="Arial, sans-serif" font-size="10" font-weight="700" fill="${MUTED}">PACE</text>
  <text x="${padX + 290}" y="${headerH - 6}" font-family="Arial, sans-serif" font-size="10" font-weight="700" fill="${MUTED}">HR</text>
  ${rows}
</svg>`;

  return sharp(Buffer.from(svg)).png({ quality: 100 }).toBuffer();
}
