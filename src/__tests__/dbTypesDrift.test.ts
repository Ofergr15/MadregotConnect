import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { applySql, buildModel, migrationOrder } from '@/lib/supabase/migration-schema';

/**
 * Hand-written DB types vs the SQL files (task 73). Fails when:
 *  - a field in a `Database.public.Tables[t].Row` interface is not a column of `t`
 *    after schema.sql + every migration (a rename/drop the types missed);
 *  - a `Database.public.Enums` entry names an enum the SQL doesn't define, or its
 *    union has different values than the enum (e.g. `ADD VALUE 'removed'`).
 * Columns the SQL has and the types don't are fine: the types are a subset.
 */

const ROOT = process.cwd();
const migrationsDir = path.join(ROOT, 'supabase/migrations');
const sources = [
  fs.readFileSync(path.join(ROOT, 'supabase/schema.sql'), 'utf8'),
  ...migrationOrder(fs.readdirSync(migrationsDir)).map((f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8')),
];
const model = buildModel(sources);

const typesPath = path.join(ROOT, 'src/lib/supabase/types.ts');
const sf = ts.createSourceFile(typesPath, fs.readFileSync(typesPath, 'utf8'), ts.ScriptTarget.Latest, true);

const interfaces = new Map<string, string[]>();
const aliases = new Map<string, ts.TypeNode>();
sf.forEachChild((n) => {
  if (ts.isInterfaceDeclaration(n)) {
    interfaces.set(n.name.text, n.members.filter(ts.isPropertySignature).map((m) => (m.name as ts.Identifier).text));
  }
  if (ts.isTypeAliasDeclaration(n)) aliases.set(n.name.text, n.type);
});

function memberType(node: ts.TypeNode | undefined, name: string): ts.TypeNode | undefined {
  if (!node || !ts.isTypeLiteralNode(node)) return undefined;
  const m = node.members.find((x) => ts.isPropertySignature(x) && (x.name as ts.Identifier).text === name) as ts.PropertySignature | undefined;
  return m?.type;
}
const dbIface = (sf.statements.find((s) => ts.isInterfaceDeclaration(s) && s.name.text === 'Database') as ts.InterfaceDeclaration);
const pub = (dbIface.members.find((m) => (m.name as ts.Identifier).text === 'public') as ts.PropertySignature).type;
const tablesNode = memberType(pub, 'Tables') as ts.TypeLiteralNode;
const enumsNode = memberType(pub, 'Enums') as ts.TypeLiteralNode;

const unionValues = (t: ts.TypeNode | undefined): string[] => {
  if (t && ts.isTypeReferenceNode(t)) return unionValues(aliases.get((t.typeName as ts.Identifier).text));
  if (t && ts.isUnionTypeNode(t)) return t.types.flatMap(unionValues);
  if (t && ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)) return [t.literal.text];
  return [];
};

describe('supabase/types.ts matches the migrations', () => {
  const tables = tablesNode.members.filter(ts.isPropertySignature).map((m) => (m.name as ts.Identifier).text);

  it.each(tables)('%s: every typed column exists', (table) => {
    const row = memberType(memberType(tablesNode, table), 'Row');
    const iface = row && ts.isTypeReferenceNode(row) ? (row.typeName as ts.Identifier).text : null;
    expect(iface, `${table}.Row should name an interface`).toBeTruthy();
    const cols = model.tables.get(table);
    expect(cols, `table ${table} is not created by schema.sql or a migration`).toBeDefined();
    const missing = (interfaces.get(iface!) || []).filter((f) => !cols!.has(f));
    expect(missing, `${iface} fields with no column in ${table}`).toEqual([]);
  });

  const enums = enumsNode.members.filter(ts.isPropertySignature);
  it.each(enums.map((e) => (e.name as ts.Identifier).text))('enum %s matches the SQL', (name) => {
    const sqlValues = model.enums.get(name);
    expect(sqlValues, `enum ${name} is not defined in the SQL`).toBeDefined();
    const typed = unionValues(enums.find((e) => (e.name as ts.Identifier).text === name)!.type);
    expect([...typed].sort()).toEqual([...sqlValues!].sort());
  });
});

describe('migration-schema parser', () => {
  it('reads create, add, drop, rename, enums and DO blocks', () => {
    const m = buildModel([
      "CREATE TABLE IF NOT EXISTS t (id UUID PRIMARY KEY, a TEXT, b INT CHECK (b > 0), CONSTRAINT x UNIQUE (a)); -- c TEXT",
      'ALTER TABLE t ADD COLUMN IF NOT EXISTS c TEXT, ADD COLUMN d INT; ALTER TABLE t DROP COLUMN IF EXISTS b;',
      'ALTER TABLE public.t RENAME COLUMN a TO a2; ALTER TABLE t ADD CONSTRAINT y CHECK (d > 0);',
      "DO $$ BEGIN ALTER TABLE t ADD COLUMN e JSONB; END $$;",
      "CREATE TYPE s AS ENUM ('x', 'y'); ALTER TYPE s ADD VALUE IF NOT EXISTS 'z';",
    ]);
    expect([...m.tables.get('t')!].sort()).toEqual(['a2', 'c', 'd', 'e', 'id']);
    expect(m.enums.get('s')).toEqual(['x', 'y', 'z']);
  });
  it('orders migrations numerically', () => {
    expect(migrationOrder(['100_a.sql', '99_b.sql', '009_c.sql', 'README.md'])).toEqual(['009_c.sql', '99_b.sql', '100_a.sql']);
  });
  it('applySql is cumulative', () => {
    const m = buildModel([]);
    applySql(m, 'CREATE TABLE u (id INT);');
    applySql(m, 'ALTER TABLE u ADD COLUMN v INT;');
    expect([...m.tables.get('u')!]).toEqual(['id', 'v']);
  });
});
