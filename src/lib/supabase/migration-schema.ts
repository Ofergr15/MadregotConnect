/**
 * A schema model read straight from the SQL files (task 73): supabase/schema.sql
 * (the ORIGINAL schema) and then supabase/migrations/NNN_*.sql in number order.
 *
 * Migrations here are pasted into the SQL editor by hand, so the files are the only
 * record of the schema the repo has; `src/lib/supabase/types.ts` is hand-written.
 * `src/__tests__/dbTypesDrift.test.ts` compares the two so a column renamed or an
 * enum value added in SQL can't silently leave the types behind (or the reverse).
 *
 * Deliberately a small parser, not Postgres: it understands CREATE TABLE column
 * lists, ALTER TABLE ADD / DROP / RENAME COLUMN, CREATE TYPE … AS ENUM and ALTER TYPE
 * … ADD VALUE, and ignores everything else. DO $$ blocks are read too, since several
 * migrations wrap their ALTERs in one for idempotence.
 */

export interface SchemaModel {
  tables: Map<string, Set<string>>;
  enums: Map<string, string[]>;
}

const IDENT = '"?([a-zA-Z_][a-zA-Z0-9_]*)"?';
const TABLE_REF = `(?:public\\.)?${IDENT}`;
const NOT_COLUMN = new Set(['constraint', 'primary', 'unique', 'foreign', 'check', 'exclude', 'like']);

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

function splitTopLevel(body: string): string[] {
  const out: string[] = [];
  let depth = 0; let cur = ''; let q = false;
  for (const ch of body) {
    if (ch === "'") q = !q;
    if (!q && ch === '(') depth++;
    if (!q && ch === ')') depth--;
    if (!q && ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

export function applySql(model: SchemaModel, rawSql: string): void {
  const sql = stripComments(rawSql);

  const createRe = new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${TABLE_REF}\\s*\\(`, 'gi');
  for (let m; (m = createRe.exec(sql)); ) {
    const table = m[1].toLowerCase();
    let depth = 1; let i = createRe.lastIndex;
    for (; i < sql.length && depth > 0; i++) { if (sql[i] === '(') depth++; else if (sql[i] === ')') depth--; }
    const cols = model.tables.get(table) || new Set<string>();
    for (const part of splitTopLevel(sql.slice(createRe.lastIndex, i - 1))) {
      const first = part.trim().match(new RegExp(`^${IDENT}`));
      if (first && !NOT_COLUMN.has(first[1].toLowerCase())) cols.add(first[1].toLowerCase());
    }
    model.tables.set(table, cols);
  }

  const alterRe = new RegExp(`ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${TABLE_REF}\\s+([\\s\\S]*?);`, 'gi');
  for (let m; (m = alterRe.exec(sql)); ) {
    const table = m[1].toLowerCase();
    const cols = model.tables.get(table) || new Set<string>();
    for (const action of splitTopLevel(m[2])) {
      const a = action.trim();
      const add = a.match(new RegExp(`^ADD\\s+(?:COLUMN\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?${IDENT}`, 'i'));
      if (add && !NOT_COLUMN.has(add[1].toLowerCase())) cols.add(add[1].toLowerCase());
      const drop = a.match(new RegExp(`^DROP\\s+COLUMN\\s+(?:IF\\s+EXISTS\\s+)?${IDENT}`, 'i'));
      if (drop) cols.delete(drop[1].toLowerCase());
      const ren = a.match(new RegExp(`^RENAME\\s+(?:COLUMN\\s+)?${IDENT}\\s+TO\\s+${IDENT}`, 'i'));
      if (ren && ren[1].toLowerCase() !== 'to') { cols.delete(ren[1].toLowerCase()); cols.add(ren[2].toLowerCase()); }
    }
    model.tables.set(table, cols);
  }

  const enumRe = new RegExp(`CREATE\\s+TYPE\\s+(?:public\\.)?${IDENT}\\s+AS\\s+ENUM\\s*\\(([^)]*)\\)`, 'gi');
  for (let m; (m = enumRe.exec(sql)); ) {
    model.enums.set(m[1].toLowerCase(), [...m[2].matchAll(/'([^']*)'/g)].map((x) => x[1]));
  }
  const addValRe = new RegExp(`ALTER\\s+TYPE\\s+(?:public\\.)?${IDENT}\\s+ADD\\s+VALUE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?'([^']*)'`, 'gi');
  for (let m; (m = addValRe.exec(sql)); ) {
    const list = model.enums.get(m[1].toLowerCase()) || [];
    if (!list.includes(m[2])) list.push(m[2]);
    model.enums.set(m[1].toLowerCase(), list);
  }
}

/** Migration files in apply order: by leading number, then name. */
export function migrationOrder(files: string[]): string[] {
  const num = (f: string) => Number(f.match(/^(\d+)/)?.[1] ?? Infinity);
  return files.filter((f) => /^\d+.*\.sql$/.test(f)).sort((a, b) => num(a) - num(b) || a.localeCompare(b));
}

export function buildModel(sources: string[]): SchemaModel {
  const model: SchemaModel = { tables: new Map(), enums: new Map() };
  for (const s of sources) applySql(model, s);
  return model;
}
