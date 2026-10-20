import { strFromU8, unzipSync } from 'fflate';

/**
 * A minimal .xlsx reader: sheet names and their cells, as plain values. Enough for a
 * spreadsheet a person exported from Google Sheets or Excel — shared strings, inline
 * strings, numbers and booleans — and nothing more (no formulas evaluated, no styles).
 *
 * Why not a spreadsheet library: the academy import (lib/academy/sheet-import.ts) reads ONE
 * known file shape in the manager's browser, so the raw file — phones, health answers —
 * never reaches our server. fflate (already in the tree through pdf/zip tooling, ~8 KB,
 * zero dependencies) does the unzip; the XML here is the small, regular part of the format.
 *
 * Dates and times come back as Excel serial numbers (days since 1899-12-30). Which column
 * is a date, a clock time or a duration is the caller's to know — the cell styles that say
 * so are deliberately not read, because this file's "times" are often durations typed as
 * mm:ss that Excel stored as hh:mm (see parseResultSeconds).
 */

export type CellValue = string | number | boolean | null;

export interface Workbook {
  /** In workbook order. */
  sheetNames: string[];
  /** Rows of cells, by sheet name. A row is as long as its last filled cell. */
  sheets: Record<string, CellValue[][]>;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Every <t>…</t> inside one <si> or <is>, joined (rich text is several runs). */
function textOf(xml: string): string {
  let out = '';
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) out += m[1] ? decodeXml(m[1]) : '';
  return out;
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]) : null;
}

/** "AB12" → 27 (zero-based column). */
export function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) out.push(m[1] ? textOf(m[1]) : '');
  return out;
}

export function parseSheetXml(xml: string, shared: string[]): CellValue[][] {
  const rows: CellValue[][] = [];
  const data = /<sheetData>([\s\S]*?)<\/sheetData>|<sheetData\/>/.exec(xml)?.[1] ?? '';
  for (const rm of data.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
    const rowAttrs = rm[1] ?? rm[3] ?? '';
    const r = Number(attr(rowAttrs, 'r')) || rows.length + 1;
    const cells: CellValue[] = [];
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = cm[1];
      const body = cm[2] ?? '';
      const ref = attr(tag, 'r');
      const col = ref ? columnIndex(ref) : cells.length;
      const t = attr(tag, 't');
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value: CellValue = null;
      if (t === 's') value = v != null ? shared[Number(v)] ?? null : null;
      else if (t === 'inlineStr') value = textOf(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? '');
      else if (t === 'str') value = v != null ? decodeXml(v) : null;
      else if (t === 'b') value = v === '1';
      else if (t === 'e') value = null;
      else if (v != null && v.trim() !== '') {
        const n = Number(v);
        value = Number.isFinite(n) ? n : decodeXml(v);
      }
      if (typeof value === 'string' && value === '') value = null;
      while (cells.length < col) cells.push(null);
      cells[col] = value;
    }
    while (rows.length < r - 1) rows.push([]);
    rows[r - 1] = cells;
  }
  return rows;
}

/** The workbook's sheets in order, each with the path of its XML part. */
export function parseWorkbookParts(workbookXml: string, relsXml: string): Array<{ name: string; path: string }> {
  const targets = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = attr(m[1], 'Id');
    const target = attr(m[1], 'Target');
    if (id && target) targets.set(id, target);
  }
  const out: Array<{ name: string; path: string }> = [];
  for (const m of workbookXml.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = attr(m[1], 'name');
    const rid = attr(m[1], 'r:id');
    const target = rid ? targets.get(rid) : null;
    if (!name || !target) continue;
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    out.push({ name, path });
  }
  return out;
}

export function readWorkbook(bytes: Uint8Array): Workbook {
  const files = unzipSync(bytes);
  const text = (p: string) => (files[p] ? strFromU8(files[p]) : '');
  const workbookXml = text('xl/workbook.xml');
  if (!workbookXml) throw new Error('not-xlsx');
  const shared = parseSharedStrings(text('xl/sharedStrings.xml'));
  const parts = parseWorkbookParts(workbookXml, text('xl/_rels/workbook.xml.rels'));
  const sheets: Record<string, CellValue[][]> = {};
  for (const p of parts) sheets[p.name] = parseSheetXml(text(p.path), shared);
  return { sheetNames: parts.map((p) => p.name), sheets };
}
