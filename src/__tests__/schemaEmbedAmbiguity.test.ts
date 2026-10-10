import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * A second foreign key between two tables breaks every unhinted embed between them.
 *
 * PostgREST resolves `athletes.select('…, groups(name)')` by the ONE foreign key from
 * athletes to groups. Migration 125 added a second (`pending_group_id`), and from the
 * moment it was pasted every such select failed with "Could not embed because more
 * than one relationship was found for 'athletes' and 'groups'" — the feed, the roster,
 * attendance and the watch push, all at once, on prod, with no deploy involved.
 *
 * Nothing in code review catches that: the migration is two correct lines, and the
 * selects it breaks are in files it never touches. So this file does two things:
 *
 *  1. Every pair of tables joined by more than one foreign key is listed below. A new
 *     pair fails here, at the moment the migration is written — before it is pasted.
 *     The fix is to hint every embed of that pair (`groups!group_id(name)`), or to
 *     leave the new column without a REFERENCES, and only then add the pair.
 *  2. athletes→groups is such a pair, and `groups` is embedded all over the app, so an
 *     unhinted `groups(` anywhere in src fails too.
 */

const ROOT = join(__dirname, '..', '..');

type Fk = { table: string; column: string; ref: string; file: string };

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

/** Top-level comma split, so `numeric(10,2)` stays one piece. */
function splitTopLevel(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

const ident = (s: string) => s.replace(/^public\./i, '').replace(/"/g, '').toLowerCase();

export function foreignKeys(sql: string, file: string): Fk[] {
  const fks: Fk[] = [];
  for (const raw of stripComments(sql).split(';')) {
    const stmt = raw.trim();
    const create = /^CREATE TABLE(?:\s+IF NOT EXISTS)?\s+([\w."]+)\s*\(([\s\S]*)\)\s*$/i.exec(stmt);
    if (create) {
      const table = ident(create[1]);
      for (const part of splitTopLevel(create[2])) {
        const p = part.trim();
        const tableFk = /FOREIGN KEY\s*\(\s*([\w"]+)\s*\)\s*REFERENCES\s+([\w."]+)/i.exec(p);
        if (tableFk) { fks.push({ table, column: ident(tableFk[1]), ref: ident(tableFk[2]), file }); continue; }
        const colFk = /^([\w"]+)\s[\s\S]*?\bREFERENCES\s+([\w."]+)/i.exec(p);
        if (colFk && !/^(CONSTRAINT|PRIMARY|UNIQUE|CHECK)$/i.test(colFk[1])) {
          fks.push({ table, column: ident(colFk[1]), ref: ident(colFk[2]), file });
        }
      }
      continue;
    }
    const alter = /^ALTER TABLE(?:\s+IF EXISTS)?(?:\s+ONLY)?\s+([\w."]+)\s+([\s\S]*)$/i.exec(stmt);
    if (alter) {
      const table = ident(alter[1]);
      for (const part of splitTopLevel(alter[2])) {
        const add = /ADD COLUMN(?:\s+IF NOT EXISTS)?\s+([\w"]+)\s[\s\S]*?\bREFERENCES\s+([\w."]+)/i.exec(part);
        if (add) { fks.push({ table, column: ident(add[1]), ref: ident(add[2]), file }); continue; }
        const con = /FOREIGN KEY\s*\(\s*([\w"]+)\s*\)\s*REFERENCES\s+([\w."]+)/i.exec(part);
        if (con) fks.push({ table, column: ident(con[1]), ref: ident(con[2]), file });
      }
    }
  }
  return fks;
}

function schemaFiles(): string[] {
  const dir = join(ROOT, 'supabase', 'migrations');
  return [
    join(ROOT, 'supabase', 'schema.sql'),
    ...readdirSync(dir).filter(f => f.endsWith('.sql')).sort().map(f => join(dir, f)),
  ];
}

function ambiguousPairs(): Map<string, string[]> {
  const byPair = new Map<string, Set<string>>();
  for (const file of schemaFiles()) {
    for (const fk of foreignKeys(readFileSync(file, 'utf8'), file)) {
      const key = `${fk.table}->${fk.ref}`;
      if (!byPair.has(key)) byPair.set(key, new Set());
      byPair.get(key)!.add(fk.column);
    }
  }
  const out = new Map<string, string[]>();
  for (const [key, cols] of byPair) if (cols.size > 1) out.set(key, [...cols].sort());
  return out;
}

/**
 * Every table pair with more than one foreign key, and the columns. Adding a pair here
 * is a statement that every embed between the two tables is hinted with `!column`.
 */
const KNOWN_AMBIGUOUS: Record<string, string[]> = {
  'academy_billing->athletes': ['athlete_id', 'updated_by'],
  'academy_coach_history->athletes': ['athlete_id', 'coach_id'],
  // 139: the trainee and the deciding coach. The one embed is hinted, `athletes!coach_id(name)`.
  'academy_coach_decisions->athletes': ['athlete_id', 'coach_id'],
  'academy_coach_pay->athletes': ['coach_id', 'updated_by'],
  'academy_payments->athletes': ['athlete_id', 'marked_by'],
  'academy_test_analyses->academy_bands': ['band_id', 'recommended_band_id'],
  'academy_test_analyses->athletes': ['approved_by', 'athlete_id', 'author_id', 'sent_by'],
  'academy_test_invitations->athletes': ['athlete_id', 'created_by'],
  'academy_test_invitations->scheduled_notifications': ['reminder_after_id', 'reminder_before_id'],
  // 135: a trainee and a coach. Nothing embeds across it; reads go through trainee-coaches.ts.
  'academy_trainee_coaches->athletes': ['athlete_id', 'coach_id'],
  'academy_tests->athletes': ['approved_by', 'athlete_id', 'author_id', 'submitted_by'],
  'academy_workout_feedback->athletes': ['athlete_id', 'author_id'],
  'athlete_claims->athletes': ['shell_athlete_id', 'target_athlete_id'],
  'athlete_favorites->athletes': ['athlete_id', 'favorite_athlete_id'],
  'athlete_follows->athletes': ['followee_id', 'follower_id'],
  // 125 pending_group_id. Every `groups(` embed in src is hinted — see the test below.
  'athletes->groups': ['group_id', 'pending_group_id'],
  'benchmark_results->athletes': ['athlete_id', 'submitted_by'],
  'run_chats->athletes': ['athlete_id', 'coach_id'],
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === '__tests__' || name === 'node_modules') continue;
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe('schema: tables joined by more than one foreign key', () => {
  it('parses a second key added by ALTER TABLE', () => {
    const fks = foreignKeys(
      'ALTER TABLE athletes ADD COLUMN IF NOT EXISTS pending_group_id uuid REFERENCES groups(id) ON DELETE SET NULL;',
      'x.sql',
    );
    expect(fks).toEqual([{ table: 'athletes', column: 'pending_group_id', ref: 'groups', file: 'x.sql' }]);
  });

  it('lists every such pair — a new one means hinting its embeds first', () => {
    const found = Object.fromEntries(ambiguousPairs());
    const added = Object.keys(found).filter(k => JSON.stringify(found[k]) !== JSON.stringify(KNOWN_AMBIGUOUS[k]));
    // Read the file header before adding the pair to KNOWN_AMBIGUOUS: a second foreign
    // key breaks every unhinted embed between the two tables, on prod, the moment the
    // migration is pasted. Hint them (`ref!column(…)`) or drop the REFERENCES.
    expect(added.map(k => `${k}: ${found[k].join(', ')}`)).toEqual([]);
  });

  it('hints every embed of groups, since athletes has two keys to it', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(ROOT, 'src'))) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (/\bgroups\s*\(/.test(line)) offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
