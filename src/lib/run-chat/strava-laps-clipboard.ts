/**
 * Render a Strava-mobile-style laps card as PNG for run-chat actuals.
 */

import sharp from 'sharp';
import { formatDuration, formatPace, type StravaLap } from '@/lib/strava/client';
import { groupLaps, type LapBlock } from './lap-groups';

export const LAPS_CLIPBOARD_VERSION = 'v4';

const ORANGE = '#FC4C02';
const TEXT = '#F8FAFC';
const MUTED = '#AFC4E8';
const BG = '#0B1830';
const ROW = '#142F63';
const BLOCK = '#1B3C7A';

const FONT = 'Arial, sans-serif';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDistanceM(distance: number, approximate = false): string {
  const text = distance >= 1000 ? `${(distance / 1000).toFixed(2)} km` : `${Math.round(distance)} m`;
  return approximate ? `~${text}` : text;
}

function paceFromSecPerKm(paceSecPerKm: number | null): string {
  if (!paceSecPerKm || !Number.isFinite(paceSecPerKm)) return '—';
  return formatPace(1000 / paceSecPerKm);
}

const LAP_ROW_H = 44;
const BLOCK_HEAD_H = 26;
const BLOCK_STEP_H = 40;

function blockHeight(block: LapBlock): number {
  return block.kind === 'lap' ? LAP_ROW_H : BLOCK_HEAD_H + block.steps.length * BLOCK_STEP_H;
}

function lapCells(opts: { y: number; rowH: number; label: string; dist: string; time: string; pace: string; hr: string; muted?: boolean }) {
  const { y, rowH, label, dist, time, pace, hr } = opts;
  const baseline = y + rowH / 2 + 5;
  const padX = 16;
  const color = opts.muted ? MUTED : TEXT;
  return `
        <text x="${padX}" y="${baseline}" font-family="${FONT}" font-size="14" font-weight="700" fill="${color}">${escapeXml(label)}</text>
        <text x="${padX + 36}" y="${baseline}" font-family="${FONT}" font-size="13" font-weight="600" fill="${color}">${escapeXml(dist)}</text>
        <text x="${padX + 130}" y="${baseline}" font-family="${FONT}" font-size="13" fill="${color}">${escapeXml(time)}</text>
        <text x="${padX + 210}" y="${baseline}" font-family="${FONT}" font-size="13" fill="${color}">${escapeXml(pace)}</text>
        <text x="${padX + 290}" y="${baseline}" font-family="${FONT}" font-size="13" fill="${MUTED}">${escapeXml(hr)}</text>`;
}

/**
 * Repeated laps (6 × [0:30 fast / 1:00 walk]) render as one block: a small
 * "6× · laps 6–17" header, then one summary row per step, instead of twelve
 * near-identical rows.
 */
export function renderLapBlocksSvg(blocks: LapBlock[], width: number, top: number): { svg: string; height: number } {
  const parts: string[] = [];
  let y = top;
  let stripe = 0;

  for (const block of blocks) {
    if (block.kind === 'lap') {
      const { lap } = block;
      const bg = stripe % 2 === 0 ? ROW : BG;
      stripe += 1;
      parts.push(`<rect x="0" y="${y}" width="${width}" height="${LAP_ROW_H}" fill="${bg}"/>`);
      parts.push(lapCells({
        y,
        rowH: LAP_ROW_H,
        label: String(block.lapNumber),
        dist: formatDistanceM(lap.distance),
        time: formatDuration(lap.moving_time),
        pace: formatPace(lap.average_speed),
        hr: lap.average_heartrate ? `${Math.round(lap.average_heartrate)}` : '—',
      }));
      y += LAP_ROW_H;
      continue;
    }

    const h = blockHeight(block);
    parts.push(`<rect x="0" y="${y}" width="${width}" height="${h}" fill="${BLOCK}"/>`);
    parts.push(`<rect x="8" y="${y + 6}" width="3" height="${h - 12}" rx="1.5" fill="${ORANGE}"/>`);
    parts.push(
      `<text x="16" y="${y + 18}" font-family="${FONT}" font-size="12" font-weight="700" fill="${ORANGE}">${block.reps}×</text>`,
      `<text x="40" y="${y + 18}" font-family="${FONT}" font-size="11" font-weight="600" fill="${MUTED}" letter-spacing="0.5">REPEAT · LAPS ${block.fromLap}–${block.toLap}</text>`,
    );
    let stepY = y + BLOCK_HEAD_H;
    for (const step of block.steps) {
      parts.push(lapCells({
        y: stepY,
        rowH: BLOCK_STEP_H,
        label: '↳',
        dist: formatDistanceM(step.distanceM, true),
        time: formatDuration(step.durationSec),
        pace: paceFromSecPerKm(step.paceSecPerKm),
        hr: step.averageHr ? `${Math.round(step.averageHr)}` : '—',
      }));
      stepY += BLOCK_STEP_H;
    }
    y += h;
    stripe = 0;
  }

  return { svg: parts.join('\n'), height: y - top };
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
  const laps = opts.laps.slice(0, 60);
  const blocks = groupLaps(laps);
  const { svg: rows, height: rowsH } = renderLapBlocksSvg(blocks, width, headerH);
  const height = headerH + rowsH + 28;

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
