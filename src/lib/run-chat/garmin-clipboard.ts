/**
 * Renders a Garmin Connect–style workout "clipboard" card as a PNG.
 * Visual target: examples/clipboard_images/*.jpeg
 */

import { readFileSync } from 'fs';
import sharp from 'sharp';
import {
  type PlannedWorkout,
  type WorkoutSegment,
  expandWorkoutSteps,
  flattenClipboardSteps,
} from './mock-workout';
import { intensityLayout } from './clipboard-layout';

/** Bump when the renderer changes so stored images regenerate. */
export const CLIPBOARD_VERSION = 'v7';

/** Horizontal inset for steps nested under a Repeat block (Garmin "tab"). */
const REPEAT_INDENT_PX = 28;

// Garmin Connect palette (matched to examples/clipboard_images)
const RED = '#FF3B30';
const BLUE = '#64D2FF';
const BLACK = '#1C1C1E';
const GREY = '#8E8E93';
const TEXT = '#1C1C1E';
/** Garmin keeps step details nearly as dark as titles */
const TEXT_SECONDARY = '#1C1C1E';
const BG = '#FFFFFF';

const KIND_COLOR: Record<string, string> = {
  warmup: RED,
  interval: BLUE,
  recovery: BLACK,
  rest: BLACK,
  cooldown: RED,
  easy: GREY,
  repeat: GREY,
};

let _fontCss: string | null = null;

function fontFaceCss(): string {
  if (_fontCss) return _fontCss;
  const faces: string[] = [];
  try {
    const hebrew = readFileSync('/System/Library/Fonts/SFHebrew.ttf');
    faces.push(`@font-face{font-family:'ClipboardHe';src:url(data:font/truetype;base64,${hebrew.toString('base64')}) format('truetype');}`);
  } catch { /* non-mac CI */ }
  try {
    const latin = readFileSync('/System/Library/Fonts/Supplemental/Arial.ttf');
    faces.push(`@font-face{font-family:'ClipboardEn';src:url(data:font/truetype;base64,${latin.toString('base64')}) format('truetype');}`);
  } catch { /* fallback */ }
  _fontCss = faces.join('');
  return _fontCss;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hasHebrew(s: string): boolean {
  return /[\u0590-\u05FF]/.test(s);
}

function fontFor(s: string): string {
  return hasHebrew(s) ? 'ClipboardHe, ClipboardEn, Arial, sans-serif' : 'ClipboardEn, ClipboardHe, Arial, sans-serif';
}

function sparklineBars(steps: WorkoutSegment[], totalW: number): string {
  const maxH = 44;
  return intensityLayout(steps, totalW)
    .map(({ step, x, width }) => {
      const color = KIND_COLOR[step.kind] ?? GREY;
      // Garmin: intervals are tallest; rest is a short stub; warmups mid-height
      const h =
        step.kind === 'interval' ? maxH :
        step.kind === 'warmup' || step.kind === 'cooldown' ? 26 :
        step.kind === 'rest' || step.kind === 'recovery' ? 12 :
        20;
      const y = maxH - h;
      return `<rect x="${x.toFixed(1)}" y="${y}" width="${width.toFixed(1)}" height="${h}" rx="2.5" fill="${color}"/>`;
    })
    .join('\n');
}

function repeatIcon(cx: number, cy: number): string {
  // Dual circular-arrow glyph (Garmin Repeat)
  return `
    <g transform="translate(${cx},${cy})" fill="none" stroke="${GREY}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M-6 -2 A8 8 0 0 1 6 -4"/>
      <path d="M4 -7 L6 -4 L3 -3"/>
      <path d="M6 2 A8 8 0 0 1 -6 4"/>
      <path d="M-4 7 L-6 4 L-3 3"/>
    </g>`;
}

function stepRows(steps: WorkoutSegment[], contentW: number): { svg: string; height: number } {
  const rowH = 56;
  const rows: string[] = [];
  let y = 0;

  for (const s of steps) {
    const indent = (s.indent ?? 0) * REPEAT_INDENT_PX;
    if (s.kind === 'repeat') {
      rows.push(`
        <g transform="translate(${indent},${y})">
          ${repeatIcon(16, 24)}
          <text x="40" y="20" font-family="${fontFor(s.label)}" font-size="16" font-weight="700" fill="${TEXT}">${escapeXml(s.label)}</text>
          <text x="40" y="40" font-family="${fontFor(s.detail)}" font-size="14" font-weight="400" fill="${TEXT_SECONDARY}">${escapeXml(s.detail)}</text>
        </g>`);
    } else {
      const color = KIND_COLOR[s.kind] ?? GREY;
      rows.push(`
        <g transform="translate(${indent},${y})">
          <rect x="8" y="8" width="7" height="34" rx="3.5" fill="${color}"/>
          <text x="30" y="22" font-family="${fontFor(s.label)}" font-size="16" font-weight="700" fill="${TEXT}">${escapeXml(s.label)}</text>
          <text x="30" y="42" font-family="${fontFor(s.detail)}" font-size="14" font-weight="400" fill="${TEXT_SECONDARY}">${escapeXml(s.detail)}</text>
        </g>`);
    }
    y += rowH;
  }

  // keep contentW referenced so layout stays consistent if we add wrapping later
  void contentW;
  return { svg: rows.join('\n'), height: y };
}

/** Build a Garmin-clipboard PNG buffer for the given planned workout. */
export async function renderGarminClipboardPng(workout: PlannedWorkout): Promise<Buffer> {
  const steps = flattenClipboardSteps(workout);
  const intensitySteps = expandWorkoutSteps(workout);
  const width = 390;
  const padX = 20;
  const contentW = width - padX * 2;
  const titleH = 56;
  const sparkH = 56;
  const sparkGap = 20;
  const { svg: rowsSvg, height: rowsH } = stepRows(steps, contentW);
  const height = titleH + sparkH + sparkGap + rowsH + 24;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <style type="text/css"><![CDATA[
      ${fontFaceCss()}
    ]]></style>
  </defs>
  <rect width="100%" height="100%" rx="16" fill="${BG}"/>

  <!-- Title (Garmin: bold, near-black, generous top padding) -->
  <text x="${padX}" y="38"
    font-family="${fontFor(workout.title)}"
    font-size="22" font-weight="700" fill="${TEXT}">${escapeXml(workout.title)}</text>

  <!-- Intensity strip -->
  <g transform="translate(${padX},${titleH})">
    ${sparklineBars(intensitySteps, contentW)}
  </g>

  <!-- Step list -->
  <g transform="translate(${padX},${titleH + sparkH + sparkGap})">
    ${rowsSvg}
  </g>
</svg>`;

  return sharp(Buffer.from(svg)).png({ quality: 100 }).toBuffer();
}
