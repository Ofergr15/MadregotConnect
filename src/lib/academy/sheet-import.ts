import type { CellValue, Workbook } from '@/lib/xlsx/read';
import { BASELINE_DISTANCES, validResult, type BaselineDistance } from './coach-baseline';
import { nameMatchConfidence } from '@/lib/auth/athlete-identity';

/**
 * The academy's own spreadsheet → the app (Ofer, 2026-10-20; mockups/roles-1019/academy-import.html).
 *
 * Before the app the academy ran on a Google Form and a sheet: the trainees' answers on
 * "Form Responses 1", and their race times on "טבלת מדדים וקצבים". This reads that file —
 * in the manager's browser, so the raw file never reaches the server — into rows that keep
 * only what the app will use. Pure: no database, no fetch.
 *
 * What is NOT kept, on purpose: blood tests, the Instagram handle and the family status. They
 * are read past and never put on a row, so no later step can store them by accident.
 */

export type SheetResults = Partial<Record<BaselineDistance, number>> & { ltHr?: number };

export interface ImportRow {
  /** The sheet's row number ("r12"): stable within one file, for decisions and merges. */
  key: string;
  submittedAt: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  /** The "מלווה" column as typed: a nickname (יאיא, סהר, …), mapped to a coach in the preview. */
  coachNick: string | null;
  /** "מי מתקשר" + "סטטוס התקשרות": the staff's call notes. Staff-only, never shown to the trainee. */
  staffNote: string | null;
  /** The call notes say "בפנים" (they're in). */
  marked: boolean;
  age: number | null;
  city: string | null;
  heightCm: number | null;
  weightKg: number | null;
  shirtSize: string | null;
  shoeSize: string | null;
  /** "דבוקה 5 אימון למרתון…" → 5. */
  requestedBand: number | null;
  goal: string | null;
  runningPast: string | null;
  achievements: string | null;
  medicalHistory: string | null;
  medicalDetails: string | null;
  hearAbout: string | null;
  strava: string | null;
  preference: string | null;
  sheetResults: SheetResults | null;
}

export const FORM_SHEET = 'Form Responses 1';
export const METRICS_SHEET = 'טבלת מדדים וקצבים';

/** Header → field. Matched by "the header contains", so a trailing space or a rewording at the end still matches. */
const FORM_COLUMNS = {
  submittedAt: ['Timestamp', 'חותמת זמן'],
  name: ['שם ושם משפחה', 'שם מלא'],
  coachNick: ['מלווה'],
  caller: ['מי מתקשר'],
  callStatus: ['סטטוס התקשרות'],
  age: ['גיל'],
  weight: ['משקל'],
  height: ['גובה'],
  city: ['מקום מגורים'],
  phone: ['הנייד', 'טלפון'],
  goal: ['מה מטרתך'],
  runningPast: ['עבר הריצה'],
  achievements: ['הישגים'],
  medicalHistory: ['עבר רפואי'],
  medicalDetails: ['ולא ענית'],
  hearAbout: ['איך שמעת'],
  shirt: ['החולצה'],
  email: ['Email', 'אימייל', 'מייל'],
  strava: ['סטראבה', 'strava'],
  pack: ['לאיזה דבוקה', 'דבוקה'],
  shoe: ['הנעליים'],
  preference: ['מה מדבר אליך'],
} as const;
type FormField = keyof typeof FORM_COLUMNS;

const squash = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();

export function headerIndex(headers: CellValue[], needles: readonly string[]): number {
  const hs = headers.map((h) => squash(h).toLowerCase());
  for (const n of needles) {
    const i = hs.findIndex((h) => h.includes(n.toLowerCase()));
    if (i >= 0) return i;
  }
  return -1;
}

function text(v: CellValue | undefined): string | null {
  if (v == null || typeof v === 'boolean') return null;
  const s = squash(typeof v === 'number' ? String(v) : v);
  return s ? s : null;
}

function num(v: CellValue | undefined): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const m = /-?\d+(?:[.,]\d+)?/.exec(v.replace(',', '.'));
  return m ? Number(m[0].replace(',', '.')) : null;
}

/** Excel serial date (days since 1899-12-30) → ISO, or a date-like string as is. */
export function excelDateToIso(v: CellValue | undefined): string | null {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    return new Date(Math.round((v - 25569) * 86_400_000)).toISOString();
  }
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  return null;
}

/** 1.74 (metres) or 174 (cm) or "1.86" → whole centimetres, or null when not a height. */
export function heightCm(v: CellValue | undefined): number | null {
  const n = num(v);
  if (n == null || n <= 0) return null;
  const cm = n < 3 ? n * 100 : n;
  return cm >= 120 && cm <= 230 ? Math.round(cm) : null;
}

export function weightKg(v: CellValue | undefined): number | null {
  const n = num(v);
  return n != null && n >= 30 && n <= 200 ? Math.round(n * 10) / 10 : null;
}

/** An Israeli mobile in its local form (0501234567). A number cell lost its leading zero. */
export function phoneIL(v: CellValue | undefined): string | null {
  if (v == null || typeof v === 'boolean') return null;
  let d = String(typeof v === 'number' ? Math.round(v) : v).replace(/\D+/g, '');
  if (d.startsWith('972')) d = `0${d.slice(3)}`;
  if (d.length === 9 && d.startsWith('5')) d = `0${d}`;
  return d.length >= 9 && d.length <= 10 ? d : null;
}

// The athletes.shirt_size CHECK (migration 061).
const SHIRTS = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
export function shirtSize(v: CellValue | undefined): string | null {
  const s = text(v)?.toUpperCase().replace(/\s+/g, '') ?? null;
  return s && SHIRTS.includes(s) ? s : null;
}

/** Shoe sizes as typed: EU (44.5) or US (9.5) — kept as the number's text, never converted. */
export function shoeSize(v: CellValue | undefined): string | null {
  const n = num(v);
  if (n == null || n < 3 || n > 50) return null;
  return String(n);
}

/** "דבוקה 5 אימון למרתון…" → 5. A stray number (39) is not a band. */
export function requestedBand(v: CellValue | undefined): number | null {
  const m = /דבוקה\s*(\d{1,2})/.exec(text(v) ?? '');
  return m ? Number(m[1]) : null;
}

/**
 * A result in seconds, from what Excel kept.
 *
 * The sheet's times were typed as "17:59" (minutes:seconds), "1:37:29" (h:mm:ss) and "3:40"
 * (h:mm). Excel reads EVERY two-part entry as hours:minutes, so "17:59" became 17 hours 59
 * minutes, and a "45:19" over 24 hours became a duration of 1 day 21:19. Two readings are
 * therefore possible for a two-part entry: as stored (h:mm), or shifted (mm:ss). Seconds that
 * aren't zero mean three parts were typed and the stored value is right. Otherwise the reading
 * that is a believable result for the distance wins (lib/academy/coach-baseline validResult),
 * and with none believable there is no result.
 */
export function parseResultSeconds(v: CellValue | undefined, km: number): number | null {
  let candidates: number[] = [];
  if (typeof v === 'number' && v > 0) {
    const literal = Math.round(v * 86_400);
    candidates = literal % 60 !== 0 ? [literal] : [literal, Math.round(v * 1440)];
  } else if (typeof v === 'string') {
    const parts = v.trim().split(':').map((p) => Number(p));
    if (parts.length < 2 || parts.length > 3 || parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
    candidates = parts.length === 3
      ? [parts[0] * 3600 + parts[1] * 60 + parts[2]]
      : [parts[0] * 3600 + parts[1] * 60, parts[0] * 60 + parts[1]];
  }
  const ok = candidates.filter((s) => validResult(km, s));
  return ok.length === 1 ? ok[0] : ok.length > 1 ? Math.min(...ok) : null;
}

/** The header row is the first row that names its columns; anything above it is a title. */
function findHeaderRow(rows: CellValue[][], needles: readonly string[]): number {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if (needles.every((n) => headerIndex(rows[i] ?? [], [n]) >= 0)) return i;
  }
  return -1;
}

export function parseFormRows(rows: CellValue[][]): ImportRow[] {
  const h = findHeaderRow(rows, [FORM_COLUMNS.name[0]]);
  if (h < 0) return [];
  const idx = Object.fromEntries(
    (Object.keys(FORM_COLUMNS) as FormField[]).map((k) => [k, headerIndex(rows[h], FORM_COLUMNS[k])]),
  ) as Record<FormField, number>;
  const at = (r: CellValue[], k: FormField) => (idx[k] >= 0 ? r[idx[k]] : undefined);
  const out: ImportRow[] = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const name = text(at(r, 'name'));
    if (!name) continue;
    const callNotes = [text(at(r, 'caller')), text(at(r, 'callStatus'))].filter(Boolean).join(' · ') || null;
    const email = text(at(r, 'email'))?.toLowerCase() ?? null;
    out.push({
      key: `r${i + 1}`,
      submittedAt: excelDateToIso(at(r, 'submittedAt')),
      name,
      email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
      phone: phoneIL(at(r, 'phone')),
      coachNick: text(at(r, 'coachNick')),
      staffNote: callNotes,
      marked: /בפנים/.test(callNotes ?? ''),
      age: (() => { const n = num(at(r, 'age')); return n != null && n >= 10 && n <= 99 ? Math.round(n) : null; })(),
      city: text(at(r, 'city')),
      heightCm: heightCm(at(r, 'height')),
      weightKg: weightKg(at(r, 'weight')),
      shirtSize: shirtSize(at(r, 'shirt')),
      shoeSize: shoeSize(at(r, 'shoe')),
      requestedBand: requestedBand(at(r, 'pack')),
      goal: text(at(r, 'goal')),
      runningPast: text(at(r, 'runningPast')),
      achievements: text(at(r, 'achievements')),
      medicalHistory: text(at(r, 'medicalHistory')),
      medicalDetails: text(at(r, 'medicalDetails')),
      hearAbout: text(at(r, 'hearAbout')),
      strava: text(at(r, 'strava')),
      preference: text(at(r, 'preference')),
      sheetResults: null,
    });
  }
  return out;
}

export interface MetricsRow { name: string; results: SheetResults }

const METRIC_COLUMNS: Array<[BaselineDistance, readonly string[]]> = [
  ['5k', ['5000', '5k', '5 ק']],
  ['10k', ['10,000', '10000', '10k', '10 ק']],
  ['hm', ['half', 'חצי']],
  ['m', ['marathon', 'מרתון']],
];

export function parseMetricsRows(rows: CellValue[][]): MetricsRow[] {
  const h = findHeaderRow(rows, ['name']);
  if (h < 0) return [];
  const nameAt = headerIndex(rows[h], ['name', 'שם']);
  const hrAt = headerIndex(rows[h], ['lt hr', 'דופק']);
  // "Half Marathon" contains "marathon": the marathon column is the one that is ONLY that.
  const cols = METRIC_COLUMNS.map(([k, needles]) => {
    if (k === 'm') {
      const hs = rows[h].map((x) => squash(x).toLowerCase());
      const i = hs.findIndex((x) => (x.includes('marathon') || x.includes('מרתון')) && !x.includes('half') && !x.includes('חצי'));
      return [k, i] as const;
    }
    return [k, headerIndex(rows[h], needles)] as const;
  });
  const out: MetricsRow[] = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const name = text(r[nameAt]);
    if (!name) continue;
    const results: SheetResults = {};
    for (const [k, c] of cols) {
      if (c < 0) continue;
      const s = parseResultSeconds(r[c], BASELINE_DISTANCES[k].km);
      if (s != null) results[k] = s;
    }
    const hr = hrAt >= 0 ? num(r[hrAt]) : null;
    if (hr != null && hr >= 100 && hr <= 220) results.ltHr = Math.round(hr);
    if (Object.keys(results).length) out.push({ name, results });
  }
  return out;
}

/**
 * The metrics sheet names people its own way (a Latin full name, a first name only, a nickname). A result is put
 * on a form row only when exactly one form row is that person: the full name in either script,
 * else — for a one-word entry — a first name that only one row has.
 */
export function attachResults(rows: ImportRow[], metrics: MetricsRow[]): ImportRow[] {
  const out = rows.map((r) => ({ ...r }));
  // Only an "exact" cross-script match counts: "near" lets short skeletons (דור / Dvir) through.
  const exact = (a: string, b: string) => nameMatchConfidence(a, b) === 'exact';
  const letters = (s: string) => s.replace(/[^\p{L}]/gu, '').length;
  for (const m of metrics) {
    const full = out.filter((r) => exact(r.name, m.name));
    let hit = full.length === 1 ? full[0] : null;
    if (!hit && !full.length && !/\s/.test(m.name.trim())) {
      let firsts = out.filter((r) => exact(r.name.split(/\s+/)[0], m.name));
      // Two first names with the same consonants (דביר, דור): the one as long as the Latin.
      if (firsts.length > 1) {
        const gap = (r: ImportRow) => Math.abs(letters(r.name.split(/\s+/)[0]) - letters(m.name));
        const best = Math.min(...firsts.map(gap));
        firsts = firsts.filter((r) => gap(r) === best);
      }
      hit = firsts.length === 1 ? firsts[0] : null;
    }
    if (hit && !hit.sheetResults) hit.sheetResults = m.results;
  }
  return out;
}

/** Same email twice: one person who filled the form again — the newest answer is kept. */
export function mergeDuplicates(rows: ImportRow[]): { rows: ImportRow[]; merged: Array<{ kept: string; dropped: string[]; name: string }> } {
  const byEmail = new Map<string, ImportRow[]>();
  const rest: ImportRow[] = [];
  for (const r of rows) {
    if (!r.email) { rest.push(r); continue; }
    (byEmail.get(r.email) ?? byEmail.set(r.email, []).get(r.email)!).push(r);
  }
  const merged: Array<{ kept: string; dropped: string[]; name: string }> = [];
  const kept: ImportRow[] = [];
  for (const group of byEmail.values()) {
    if (group.length === 1) { kept.push(group[0]); continue; }
    const sorted = [...group].sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''));
    const top = { ...sorted[0] };
    // The newest answer, with what only an older one had filled in.
    for (const older of sorted.slice(1)) {
      for (const k of Object.keys(top) as (keyof ImportRow)[]) {
        if (top[k] == null && older[k] != null) (top as Record<string, unknown>)[k] = older[k];
      }
    }
    kept.push(top);
    merged.push({ kept: top.key, dropped: sorted.slice(1).map((r) => r.key), name: top.name });
  }
  const order = new Map(rows.map((r, i) => [r.key, i]));
  return { rows: [...kept, ...rest].sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0)), merged };
}

export interface ParsedImport {
  rows: ImportRow[];
  merged: Array<{ kept: string; dropped: string[]; name: string }>;
  /** Form rows with results from the metrics sheet. */
  withResults: number;
  problems: string[];
}

export function parseAcademyWorkbook(wb: Workbook): ParsedImport {
  const problems: string[] = [];
  const formName = wb.sheetNames.find((n) => n.trim() === FORM_SHEET) ?? wb.sheetNames[0];
  const form = formName ? parseFormRows(wb.sheets[formName] ?? []) : [];
  if (!form.length) problems.push('no-form-rows');
  const metricsName = wb.sheetNames.find((n) => n.trim() === METRICS_SHEET);
  const metrics = metricsName ? parseMetricsRows(wb.sheets[metricsName] ?? []) : [];
  // Merged first: one person who filled the form twice is one name for the results to find.
  const { rows: once, merged } = mergeDuplicates(form);
  const rows = attachResults(once, metrics);
  return { rows, merged, withResults: rows.filter((r) => r.sheetResults).length, problems };
}

// ── Coaches ─────────────────────────────────────────────────────────────────────────────

/** The sheet's nicknames, as the academy wrote them, → a word of the coach's Latin name. */
export const DEFAULT_COACH_NICKS: Record<string, string> = {
  'יאיא': 'yair', 'יאיר': 'yair', 'סהר': 'sahar', 'שפיגל': 'spiegel', 'איתי': 'spiegel', 'אלדר': 'eldar',
};

/** The coach a nickname means, from the academy's coaches, or null when it isn't clear. */
export function coachForNick(nick: string | null, coaches: ReadonlyArray<{ id: string; name: string }>): string | null {
  const n = squash(nick);
  if (!n) return null;
  const word = DEFAULT_COACH_NICKS[n];
  // A nickname the academy uses means its coach by a word of the Latin name; any other is
  // the coach's first name in Hebrew, matched exactly (a near match is a guess).
  const hits = coaches.filter((c) => word
    ? c.name.toLowerCase().split(/\s+/).includes(word)
    : nameMatchConfidence(n, c.name.split(/\s+/)[0]) === 'exact');
  return hits.length === 1 ? hits[0].id : null;
}

/** The nicknames in the file, with how many rows each, most first. */
export function coachNicks(rows: ImportRow[]): Array<{ nick: string; count: number }> {
  const m = new Map<string, number>();
  for (const r of rows) { const n = squash(r.coachNick); if (n) m.set(n, (m.get(n) ?? 0) + 1); }
  return [...m.entries()].map(([nick, count]) => ({ nick, count })).sort((a, b) => b.count - a.count);
}

// ── What is stored ──────────────────────────────────────────────────────────────────────

/**
 * The card's intake for an imported row: the prefill the trainee confirms, and the file's
 * results. Underscore keys are staff-only and never returned to the trainee (importPrefill).
 * A whitelist, so a field nobody listed here cannot reach the database.
 */
export function importIntake(r: ImportRow, extra: { coachIds: string[]; bandId: string | null }): Record<string, unknown> {
  const prefill: Record<string, unknown> = {
    city: r.city, height: r.heightCm, weight: r.weightKg, shirtSize: r.shirtSize, shoeSize: r.shoeSize,
    goal: r.goal, runningHistory: r.runningPast, achievements: r.achievements,
    medicalHistory: r.medicalHistory, medicalDetails: r.medicalDetails, hearAbout: r.hearAbout,
    strava: r.strava, focus: r.preference, age: r.age,
  };
  for (const k of Object.keys(prefill)) if (prefill[k] == null) delete prefill[k];
  return {
    imported: prefill,
    ...(r.sheetResults ? { sheet_results: r.sheetResults } : {}),
    _import: {
      rowKey: r.key, submittedAt: r.submittedAt, coachNick: r.coachNick, coachIds: extra.coachIds,
      requestedBand: r.requestedBand, requestedBandId: extra.bandId, staffNote: r.staffNote, marked: r.marked,
    },
  };
}

/** The keys an imported prefill may hand to the trainee's form — nothing staff-only. */
export const PREFILL_KEYS = ['city', 'height', 'weight', 'shirtSize', 'shoeSize', 'medicalHistory', 'medicalDetails', 'hearAbout'] as const;

export function importPrefill(intake: unknown): Record<string, string> | null {
  const imp = intake && typeof intake === 'object' ? (intake as Record<string, unknown>).imported : null;
  if (!imp || typeof imp !== 'object') return null;
  const out: Record<string, string> = {};
  for (const k of PREFILL_KEYS) {
    const v = (imp as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = String(v);
  }
  return out;
}

/** Whether a card came from the file (its intake carries the import's staff block). */
export function isImportedIntake(intake: unknown): boolean {
  return !!(intake && typeof intake === 'object' && (intake as Record<string, unknown>)._import);
}

/** The intake keys the form never owns: what the file said, its results, the staff block. */
export const KEPT_INTAKE_KEYS = ['_import', 'imported', 'sheet_results'] as const;

/**
 * The form's answers as the new intake — as before, the form replaces what it answered — except
 * the keys the form never owns (KEPT_INTAKE_KEYS), which stay as they were. A card that never
 * had them gets exactly the form's answers.
 */
export function mergeIntake(existing: unknown, form: Record<string, unknown> | null): Record<string, unknown> | null {
  const base = existing && typeof existing === 'object' ? (existing as Record<string, unknown>) : {};
  const keep: Record<string, unknown> = {};
  for (const k of KEPT_INTAKE_KEYS) if (base[k] !== undefined) keep[k] = base[k];
  if (!form) return Object.keys(base).length ? { ...base } : null;
  const cleanForm = { ...form };
  for (const k of KEPT_INTAKE_KEYS) delete cleanForm[k];
  return { ...cleanForm, ...keep };
}

// ── Tracking ────────────────────────────────────────────────────────────────────────────

export type ImportStage = 'not_invited' | 'invited' | 'confirmed' | 'in_app';

export function importStage(card: { invited_at: string | null; accepted_at: string | null }, athlete: { first_seen_at?: string | null } | null, formDone: boolean): ImportStage {
  if (athlete?.first_seen_at) return 'in_app';
  if (card.accepted_at || formDone) return 'confirmed';
  if (card.invited_at) return 'invited';
  return 'not_invited';
}

export const STUCK_HOURS = 48;

export function isStuck(stage: ImportStage, invitedAt: string | null, now = Date.now()): boolean {
  if (stage !== 'invited' || !invitedAt) return false;
  return now - Date.parse(invitedAt) >= STUCK_HOURS * 3_600_000;
}

// ── The rows as the server takes them ───────────────────────────────────────────────────

const MAX_ROWS = 300;
const str = (v: unknown, max = 400): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const numOr = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

function cleanResults(v: unknown): SheetResults | null {
  if (!v || typeof v !== 'object') return null;
  const out: SheetResults = {};
  for (const k of Object.keys(BASELINE_DISTANCES) as BaselineDistance[]) {
    const s = (v as Record<string, unknown>)[k];
    if (typeof s === 'number' && validResult(BASELINE_DISTANCES[k].km, s)) out[k] = Math.round(s);
  }
  const hr = numOr((v as Record<string, unknown>).ltHr, 100, 220);
  if (hr != null) out.ltHr = Math.round(hr);
  return Object.keys(out).length ? out : null;
}

/**
 * What the browser sent, re-checked field by field: only ImportRow's keys, each of its type
 * and size. Anything else in the body (a column the parser should never have kept) is dropped
 * here too, so the whitelist holds even against a hand-made request.
 */
export function cleanRows(raw: unknown): ImportRow[] {
  if (!Array.isArray(raw)) return [];
  const out: ImportRow[] = [];
  for (const x of raw.slice(0, MAX_ROWS)) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    const name = str(r.name, 80);
    const key = str(r.key, 12);
    if (!name || !key || !/^r\d+$/.test(key)) continue;
    const email = str(r.email, 120)?.toLowerCase() ?? null;
    out.push({
      key, name,
      submittedAt: str(r.submittedAt, 40),
      email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
      phone: phoneIL(str(r.phone, 30)),
      coachNick: str(r.coachNick, 40),
      staffNote: str(r.staffNote, 600),
      marked: r.marked === true,
      age: numOr(r.age, 10, 99),
      city: str(r.city, 80),
      heightCm: numOr(r.heightCm, 120, 230),
      weightKg: numOr(r.weightKg, 30, 200),
      shirtSize: shirtSize(str(r.shirtSize, 6)),
      shoeSize: shoeSize(str(r.shoeSize, 6)),
      requestedBand: numOr(r.requestedBand, 1, 20),
      goal: str(r.goal), runningPast: str(r.runningPast, 1000), achievements: str(r.achievements, 1000),
      medicalHistory: str(r.medicalHistory, 200), medicalDetails: str(r.medicalDetails, 1000),
      hearAbout: str(r.hearAbout, 200), strava: str(r.strava, 200), preference: str(r.preference, 200),
      sheetResults: cleanResults(r.sheetResults),
    });
  }
  return out;
}
