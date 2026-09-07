/**
 * Renders a Garmin Connect–style workout "clipboard" card as a PNG.
 * Visual target: examples/clipboard_images/*.jpeg
 */

import { existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Resvg } from '@resvg/resvg-js';
import {
  type PlannedWorkout,
  type WorkoutSegment,
  expandWorkoutSteps,
  flattenClipboardSteps,
} from './mock-workout';
import { intensityLayout } from './clipboard-layout';
import { DEJAVU_SANS_BASE64 } from './dejavu-sans.generated';

/** Bump when the renderer changes so stored images regenerate. */
export const CLIPBOARD_VERSION = 'v11';

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

let _fontPaths: string[] | null = null;

function writeBundledFont(filename: string, base64: string): string {
  const path = join(tmpdir(), filename);
  if (!existsSync(path)) {
    writeFileSync(path, Buffer.from(base64, 'base64'));
  }
  return path;
}

function fontPaths(): string[] {
  if (_fontPaths) return _fontPaths;
  _fontPaths = [
    writeBundledFont('madregot-dejavu-sans.ttf', DEJAVU_SANS_BASE64),
  ];
  return _fontPaths;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fontFor(_s: string): string {
  return 'DejaVu Sans';
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

/**
 * The distance line under the title: "11–13 ק״מ", and on a derived figure the
 * words that say so.
 *
 * A single number when the two ends match, because "12–12 ק״מ" reads as a
 * mistake. The range is written with an ASCII hyphen rather than an en-dash: the
 * hyphen keeps the two ends bound to the number instead of letting the
 * surrounding Hebrew flip them into a countdown.
 *
 * The line is wrapped in an RTL isolate (U+2067 … U+2069) because resvg lays
 * every text run out on a hard left-to-right base and ignores `direction="rtl"`.
 * Measured, unwrapped, the three parts land number-leftmost and "ק״מ"
 * rightmost — so a Hebrew reader meets the unit first and the number last, i.e.
 * the line backwards. The isolate gives the run an RTL base, which puts the
 * number at the right edge where the eye starts, the unit next to it, and the
 * "derived" qualifier last.
 */
export function distanceLine(d: PlannedWorkout['distanceKm']): string | null {
  if (!d || d.max <= 0) return null;
  const fmt = (n: number) => String(Math.round(n * 10) / 10);
  const range = d.max > d.min ? `${fmt(d.min)}-${fmt(d.max)}` : fmt(d.max);
  return `⁧${range} ק״מ${d.estimated ? ' · מחושב מזמן וקצב' : ''}⁩`;
}

/** Build a Garmin-clipboard PNG buffer for the given planned workout. */
export async function renderGarminClipboardPng(workout: PlannedWorkout): Promise<Buffer> {
  const steps = flattenClipboardSteps(workout);
  const intensitySteps = expandWorkoutSteps(workout);
  const width = 390;
  const padX = 20;
  const contentW = width - padX * 2;
  const distanceText = distanceLine(workout.distanceKm);
  // Room for the distance line when there is one. Rest days and drills sessions
  // have none, and the card should not carry a blank row for them.
  const titleH = distanceText ? 78 : 56;
  const sparkH = 56;
  const sparkGap = 20;
  const { svg: rowsSvg, height: rowsH } = stepRows(steps, contentW);
  const height = titleH + sparkH + sparkGap + rowsH + 24;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" rx="16" fill="${BG}"/>

  <!-- Title (Garmin: bold, near-black, generous top padding) -->
  <text x="${padX}" y="38"
    font-family="${fontFor(workout.title)}"
    font-size="22" font-weight="700" fill="${TEXT}">${escapeXml(workout.title)}</text>
${distanceText ? `
  <!-- How far this session is — the one number the board never carried -->
  <text x="${padX}" y="62"
    font-family="${fontFor(distanceText)}"
    font-size="15" font-weight="700" fill="${GREY}">${escapeXml(distanceText)}</text>` : ''}

  <!-- Intensity strip -->
  <g transform="translate(${padX},${titleH})">
    ${sparklineBars(intensitySteps, contentW)}
  </g>

  <!-- Step list -->
  <g transform="translate(${padX},${titleH + sparkH + sparkGap})">
    ${rowsSvg}
  </g>
</svg>`;

  const renderer = new Resvg(svg, {
    font: {
      fontFiles: fontPaths(),
      loadSystemFonts: false,
      defaultFontFamily: 'DejaVu Sans',
      sansSerifFamily: 'DejaVu Sans',
    },
    languages: ['he'],
    textRendering: 1,
  });
  return renderer.render().asPng();
}
