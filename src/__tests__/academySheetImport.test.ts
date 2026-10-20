import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { columnIndex, readWorkbook } from '@/lib/xlsx/read';
import {
  attachResults, cleanRows, coachForNick, coachNicks, excelDateToIso, heightCm, importIntake, importPrefill, importStage,
  isImportedIntake, isStuck, mergeDuplicates, mergeIntake, parseAcademyWorkbook, parseFormRows, parseMetricsRows,
  parseResultSeconds, phoneIL, requestedBand, shirtSize, type ImportRow,
} from '@/lib/academy/sheet-import';
import { genderColumn, importProfileColumns, maskPhone } from '@/lib/academy/import-form';

/**
 * The academy's file → the app (mockups/roles-1019/academy-import.html), the pure half: the
 * .xlsx reader, the form and metrics sheets, the matching, what is stored and what is not.
 * Every row here is made up; the real file is never a fixture.
 */

// ── A synthetic workbook, built the way Google Sheets exports one ─────────────────────────
type C = string | number | null;
function sheetXml(rows: C[][], shared: string[]): string {
  const col = (i: number) => { let s = ''; i += 1; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    if (v == null) return '';
    const ref = `${col(ci)}${ri + 1}`;
    if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
    let i = shared.indexOf(v); if (i < 0) { shared.push(v); i = shared.length - 1; }
    return `<c r="${ref}" t="s"><v>${i}</v></c>`;
  }).join('')}</row>`).join('');
  return `<?xml version="1.0"?><worksheet><sheetData>${body}</sheetData></worksheet>`;
}
function xlsx(sheets: Record<string, C[][]>): Uint8Array {
  const shared: string[] = [];
  const names = Object.keys(sheets);
  const files: Record<string, Uint8Array> = {};
  names.forEach((n, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sheets[n], shared)); });
  files['xl/workbook.xml'] = strToU8(`<workbook xmlns:r="r"><sheets>${names.map((n, i) => `<sheet name="${n.replace(/&/g, '&amp;')}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  files['xl/_rels/workbook.xml.rels'] = strToU8(`<Relationships>${names.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`);
  files['xl/sharedStrings.xml'] = strToU8(`<sst>${shared.map((s) => `<si><t>${s.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></si>`).join('')}</sst>`);
  return zipSync(files);
}

const FORM_HEADERS = ['Timestamp', 'שם ושם משפחה', 'מלווה', 'מי מתקשר', 'סטטוס התקשרות', 'גיל ', 'משקל ', 'גובה', 'מקום מגורים', 'סטטוס משפחתי ',
  'מה מספר הנייד שלך ', 'מה מטרתך מההשתתפות בקבוצת הריצה', 'עבר הריצה שלך בשנה האחרונה ', 'במידה ויש הישגים בתחום הריצה  אנא פרט\\י', 'עבר רפואי ',
  'במידה  ולא ענית בריא לחלוטין  בשאלה הקודמת אנא פרט', 'במידה ויש בדיקות דם מהחצי שנה הראשונה אשמח לשיתוף', 'איך שמעת על קבוצת הריצה ',
  'תוכל לשתף את עמוד האינסטגרם שלך במידה ויש ', 'מה מידת החולצה שלך ', 'Score', 'Email Address', 'במידה ויש לך חשבון סטראבה אנא כתוב את השם',
  'לאיזה דבוקה תרצה להשתייך', 'מה מידת הנעליים שלך ', 'מה מדבר אליך יותר'];
const formRow = (o: Partial<Record<string, C>>): C[] => FORM_HEADERS.map((h) => (o[h] ?? null));
const SECRET_BLOOD = 'BLOOD-PANEL-SECRET';
const SECRET_IG = 'insta_secret_handle';
const SECRET_FAMILY = 'FAMILY-STATUS-SECRET';

const workbook = () => xlsx({
  'Form Responses 1': [
    FORM_HEADERS,
    formRow({ Timestamp: 46170.5, 'שם ושם משפחה': 'דביר כהנא', 'מלווה': 'שפיגל', 'מי מתקשר': 'אלדר', 'סטטוס התקשרות': 'בפנים', 'גיל ': 30, 'משקל ': 77, 'גובה': 1.86,
      'מקום מגורים': 'חיפה', 'סטטוס משפחתי ': SECRET_FAMILY, 'מה מספר הנייד שלך ': 541234567, 'עבר רפואי ': 'בריא לחלוטין',
      'במידה ויש בדיקות דם מהחצי שנה הראשונה אשמח לשיתוף': SECRET_BLOOD, 'תוכל לשתף את עמוד האינסטגרם שלך במידה ויש ': SECRET_IG,
      'מה מידת החולצה שלך ': 'L', 'Email Address': 'Dvir.K@Example.com', 'לאיזה דבוקה תרצה להשתייך': 'דבוקה 5 אימון למרתון באזור ה3:30', 'מה מידת הנעליים שלך ': 44.5 }),
    formRow({ Timestamp: 46171.5, 'שם ושם משפחה': 'דור לוי', 'מלווה': 'יאיא', 'גובה': 182, 'Email Address': 'dor@example.com', 'מה מידת החולצה שלך ': '0.0', 'לאיזה דבוקה תרצה להשתייך': '39.0' }),
    formRow({ Timestamp: 46172.5, 'שם ושם משפחה': 'רוני גולן', 'מלווה': 'סהר', 'Email Address': 'roni@example.com' }),
    formRow({ Timestamp: 46175.5, 'שם ושם משפחה': 'רוני גולן', 'מלווה': 'סהר', 'Email Address': 'roni@example.com', 'מקום מגורים': 'רמת גן' }),
    formRow({ 'שם ושם משפחה': 'עומר וייס', 'מלווה': 'יאיא' }),
    formRow({}),
  ],
  'טבלת מדדים וקצבים': [
    ['Madregot academy – Run – Intensity Targets'],
    ['דבוקה', 'Name', '5000m', '10,000m', 'Half Marathon', 'Marathon', 'LT HR (bpm)'],
    [4, 'Roni Golan', 0.8333333333333334, 1.75, 0.06388888888888888, 0.14583333333333334, 170],
    [null, 'Dvir', 1.0416666666666667, 1.9166666666666667, 0.06944444444444445, 0.1625, 175],
  ],
});

describe('the .xlsx reader', () => {
  it('reads sheet names, shared strings, numbers and sparse cells', () => {
    const wb = readWorkbook(xlsx({ 'A & B': [['x', null, 3], [null, 'y']] }));
    expect(wb.sheetNames).toEqual(['A & B']);
    expect(wb.sheets['A & B']).toEqual([['x', null, 3], [null, 'y']]);
  });
  it('columns past Z', () => expect([columnIndex('A1'), columnIndex('Z9'), columnIndex('AA3'), columnIndex('AB12')]).toEqual([0, 25, 26, 27]));
  it('says so when it is not an xlsx', () => expect(() => readWorkbook(zipSync({ 'a.txt': strToU8('hi') }))).toThrow('not-xlsx'));
});

describe('cells as the file kept them', () => {
  it('mm:ss typed into Excel came back as hh:mm — the believable reading wins', () => {
    expect(parseResultSeconds(0.7493055555555556, 5)).toBe(1079);         // "17:59" for 5 km
    expect(parseResultSeconds(1.8881944444444445, 10)).toBe(2719);        // "45:19", over 24 h
    expect(parseResultSeconds(0.06769675925925926, 21.0975)).toBe(5849);  // "1:37:29" — seconds, so literal
    expect(parseResultSeconds(0.1527777777777778, 42.195)).toBe(13200);   // "3:40" marathon = h:mm
    expect(parseResultSeconds(1, 5)).toBe(1440);                          // "24:00" = 1 day
    expect(parseResultSeconds('25:00', 5)).toBe(1500);
    expect(parseResultSeconds('1:32:00', 21.0975)).toBe(5520);
    expect(parseResultSeconds('fast', 5)).toBeNull();
    expect(parseResultSeconds(0.001, 42.195)).toBeNull();
  });
  it('heights in metres or centimetres, phones that lost their zero, sizes and packs', () => {
    expect([heightCm(1.74), heightCm(182), heightCm('1.86'), heightCm(0), heightCm(4)]).toEqual([174, 182, 186, null, null]);
    expect([phoneIL(501234567), phoneIL('050-123-4567'), phoneIL('+972501234567'), phoneIL(123)]).toEqual(['0501234567', '0501234567', '0501234567', null]);
    expect([shirtSize('L'), shirtSize(' xl '), shirtSize('0.0')]).toEqual(['L', 'XL', null]);
    expect([requestedBand('דבוקה 5 אימון למרתון'), requestedBand('דבוקה 4'), requestedBand('39.0')]).toEqual([5, 4, null]);
    expect(excelDateToIso(46170.5)).toBe('2026-05-28T12:00:00.000Z');
  });
});

describe('the two sheets', () => {
  const parsed = parseAcademyWorkbook(readWorkbook(workbook()));
  const by = (n: string) => parsed.rows.find((r) => r.name === n)!;

  it('one row per person, the duplicate merged (newest kept, its gaps filled)', () => {
    expect(parsed.rows.map((r) => r.name)).toEqual(['דביר כהנא', 'דור לוי', 'רוני גולן', 'עומר וייס']);
    expect(parsed.merged).toEqual([expect.objectContaining({ name: 'רוני גולן' })]);
    expect(by('רוני גולן').city).toBe('רמת גן');
  });
  it('the fields the app uses, normalised', () => {
    expect(by('דביר כהנא')).toMatchObject({
      email: 'dvir.k@example.com', phone: '0541234567', heightCm: 186, weightKg: 77, shirtSize: 'L', shoeSize: '44.5',
      requestedBand: 5, coachNick: 'שפיגל', marked: true, staffNote: 'אלדר · בפנים', medicalHistory: 'בריא לחלוטין',
    });
    expect(by('דור לוי')).toMatchObject({ heightCm: 182, shirtSize: null, requestedBand: null });
    expect(by('עומר וייס').email).toBeNull();
  });
  it('NEVER keeps blood tests, Instagram or family status', () => {
    const all = JSON.stringify(parsed);
    for (const secret of [SECRET_BLOOD, SECRET_IG, SECRET_FAMILY]) expect(all).not.toContain(secret);
  });
  it('results attach across scripts: "Roni Golan" ↔ רוני גולן, one-word "Dvir" ↔ דביר (not דור)', () => {
    expect(by('רוני גולן').sheetResults).toMatchObject({ '5k': 1200, '10k': 2520, hm: 5520, m: 12600, ltHr: 170 });
    expect(by('דביר כהנא').sheetResults).toMatchObject({ '5k': 1500, '10k': 2760, ltHr: 175 });
    expect(by('דור לוי').sheetResults).toBeNull();
    expect(parsed.withResults).toBe(2);
  });
  it('missing columns are empty fields, not a crash', () => {
    const rows = parseFormRows([['שם ושם משפחה'], ['רק שם']]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'רק שם', email: null, phone: null, heightCm: null, sheetResults: null });
    expect(parseMetricsRows([['x']])).toEqual([]);
    expect(parseFormRows([])).toEqual([]);
  });
  it('an ambiguous one-word name attaches to nobody', () => {
    const rows = [{ name: 'דניאל כהן' }, { name: 'דניאל לוי' }].map((r, i) => ({ ...parseFormRows([['שם ושם משפחה'], [r.name]])[0], key: `r${i + 2}` }));
    expect(attachResults(rows, [{ name: 'Daniel', results: { '5k': 1300 } }]).every((r) => !r.sheetResults)).toBe(true);
  });
  it('merge keeps the newest submission', () => {
    const base = parseFormRows([['שם ושם משפחה', 'Email Address', 'Timestamp', 'מקום מגורים'], ['א', 'a@x.com', 46100, 'ישן'], ['א', 'a@x.com', 46200, null]]);
    const { rows } = mergeDuplicates(base);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'r3', city: 'ישן' });
  });
});

describe('coaches from the "מלווה" nicknames', () => {
  const coaches = [
    { id: 'y', name: 'Yair Gabbay' }, { id: 's', name: 'Sahar Azar' }, { id: 'i', name: 'Itai Spiegel' }, { id: 'e', name: 'Eldar Pardo' },
  ];
  it('the academy\'s nicknames', () => {
    expect(['יאיא', 'סהר', 'שפיגל', 'אלדר', ' יאיא '].map((n) => coachForNick(n, coaches))).toEqual(['y', 's', 'i', 'e', 'y']);
  });
  it('an unknown nickname, or a coach not in the list, is left for the manager', () => {
    expect(coachForNick('רום היחפן', coaches)).toBeNull();
    expect(coachForNick('שפיגל', coaches.filter((c) => c.id !== 'i'))).toBeNull();
    expect(coachForNick(null, coaches)).toBeNull();
  });
  it('counts per nickname, most first', () => {
    const rows = ['יאיא', 'סהר', 'יאיא', null].map((n, i) => ({ ...parseFormRows([['שם ושם משפחה'], ['x']])[0], key: `r${i}`, coachNick: n }));
    expect(coachNicks(rows as ImportRow[])).toEqual([{ nick: 'יאיא', count: 2 }, { nick: 'סהר', count: 1 }]);
  });
});

describe('what is stored, and what the trainee sees', () => {
  const row = parseAcademyWorkbook(readWorkbook(workbook())).rows[0];
  const intake = importIntake(row, { coachIds: ['i'], bandId: 'band-5' });

  it('the prefill, the results, and a staff-only block', () => {
    expect(intake.imported).toMatchObject({ city: 'חיפה', height: 186, weight: 77, shirtSize: 'L', shoeSize: '44.5', medicalHistory: 'בריא לחלוטין' });
    expect(intake.sheet_results).toMatchObject({ '5k': 1500 });
    expect(intake._import).toMatchObject({ coachIds: ['i'], requestedBand: 5, requestedBandId: 'band-5', staffNote: 'אלדר · בפנים', marked: true });
    expect(isImportedIntake(intake)).toBe(true);
    expect(isImportedIntake({ firstName: 'x' })).toBe(false);
  });
  it('the trainee\'s prefill has no call notes, no coach, no staff block', () => {
    const p = importPrefill(intake)!;
    expect(p).toMatchObject({ city: 'חיפה', height: '186', weight: '77', shirtSize: 'L' });
    const seen = JSON.stringify(p);
    for (const hidden of ['אלדר', 'בפנים', 'שפיגל', '_import', 'band-5']) expect(seen).not.toContain(hidden);
  });
  it('the form replaces its own answers and keeps the file\'s', () => {
    const merged = mergeIntake(intake, { firstName: 'דביר', city: 'עכו', _import: 'forged', sheet_results: { '5k': 1 } })!;
    expect(merged).toMatchObject({ firstName: 'דביר', city: 'עכו' });
    expect(merged._import).toEqual(intake._import);
    expect(merged.sheet_results).toEqual(intake.sheet_results);
    expect(mergeIntake({ a: 1, b: 2 }, { a: 3 })).toEqual({ a: 3 });
    expect(mergeIntake(null, null)).toBeNull();
  });
  it('the profile columns the form fills — only values the columns accept', () => {
    expect(importProfileColumns({ birthDate: '1990-02-28', gender: 'אישה', height: '186', weight: '77.5', shirtSize: 'L', shoeSize: '44.5' }))
      .toEqual({ birth_date: '1990-02-28', gender: 'female', height_cm: 186, weight_kg: 77.5, shirt_size: 'L', shoe_size: '44.5' });
    expect(importProfileColumns({ birthDate: '1990-02-31', gender: 'x', height: '9', shirtSize: 'XXXL', shoeSize: '9.5' })).toEqual({});
    expect(genderColumn('גבר')).toBe('male');
    expect(maskPhone('054-123-8285')).toBe('•••• 8285');
  });
});

describe('the rows as the server takes them', () => {
  it('keeps only ImportRow\'s fields, typed and sized', () => {
    const [r] = cleanRows([{ key: 'r2', name: 'דביר', email: 'D@X.COM', bloodTests: SECRET_BLOOD, instagram: SECRET_IG, familyStatus: SECRET_FAMILY,
      heightCm: 186, sheetResults: { '5k': 1500, bogus: 9 }, staffNote: 'בפנים', marked: true }]);
    expect(r).toMatchObject({ key: 'r2', name: 'דביר', email: 'd@x.com', heightCm: 186, sheetResults: { '5k': 1500 }, marked: true });
    const s = JSON.stringify(r);
    for (const secret of [SECRET_BLOOD, SECRET_IG, SECRET_FAMILY, 'bogus']) expect(s).not.toContain(secret);
  });
  it('drops rows without a name or a sheet row key', () => {
    expect(cleanRows([{ key: 'x', name: 'a' }, { key: 'r3' }, null, 'junk'])).toEqual([]);
    expect(cleanRows('nope')).toEqual([]);
  });
});

describe('where each one is', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  it('not invited → invited → confirmed → in the app', () => {
    expect(importStage({ invited_at: null, accepted_at: null }, null, false)).toBe('not_invited');
    expect(importStage({ invited_at: '2026-10-19', accepted_at: null }, null, false)).toBe('invited');
    expect(importStage({ invited_at: '2026-10-19', accepted_at: null }, null, true)).toBe('confirmed');
    expect(importStage({ invited_at: '2026-10-19', accepted_at: '2026-10-20' }, { first_seen_at: null }, true)).toBe('confirmed');
    expect(importStage({ invited_at: '2026-10-19', accepted_at: '2026-10-20' }, { first_seen_at: '2026-10-20' }, true)).toBe('in_app');
  });
  it('stuck = invited 48 hours ago and not confirmed', () => {
    expect(isStuck('invited', '2026-10-18T12:00:00Z', now)).toBe(true);
    expect(isStuck('invited', '2026-10-18T12:00:01Z', now)).toBe(false);
    expect(isStuck('confirmed', '2026-10-10T12:00:00Z', now)).toBe(false);
  });
});
