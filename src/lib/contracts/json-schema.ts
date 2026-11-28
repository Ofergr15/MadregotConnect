/**
 * A deliberately small JSON-Schema subset for API response contracts
 * (docs/contracts/ios-routes.json): type (single or list), properties, required,
 * items, enum, allOf, oneOf and `$ref: "#/$defs/<Name>"`. Unknown properties are
 * always allowed, because an added field never breaks a Codable client.
 *
 * Two jobs:
 *  - `validate(schema, value, defs)` — does a real response body fit the contract?
 *  - `breakingChanges(old, next, ...)` — would a client built against `old` break
 *    against a server that answers `next`? (Removing a field, making a required
 *    field optional or nullable, widening a type, or adding an enum value.)
 */

export type JsonType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';

export interface Schema {
  type?: JsonType | JsonType[];
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  enum?: unknown[];
  allOf?: Schema[];
  oneOf?: Schema[];
  $ref?: string;
  [k: string]: unknown;
}

export type Defs = Record<string, Schema>;

const typesOf = (s: Schema): JsonType[] | null => (s.type == null ? null : Array.isArray(s.type) ? s.type : [s.type]);

function jsonTypeOf(v: unknown): JsonType {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v as JsonType;
}

export function resolve(s: Schema, defs: Defs): Schema {
  let cur = s;
  for (let hops = 0; cur.$ref; hops++) {
    const name = cur.$ref.replace(/^#\/\$defs\//, '');
    const next = defs[name];
    if (!next || hops > 20) throw new Error(`unresolvable $ref ${cur.$ref}`);
    cur = next;
  }
  return cur;
}

export function validate(schema: Schema, value: unknown, defs: Defs = {}, path = '$'): string[] {
  const s = resolve(schema, defs);
  const errors: string[] = [];
  if (s.allOf) for (const sub of s.allOf) errors.push(...validate(sub, value, defs, path));
  if (s.oneOf) {
    const fits = s.oneOf.filter((sub) => validate(sub, value, defs, path).length === 0).length;
    if (fits !== 1) errors.push(`${path}: matches ${fits} of oneOf (needs exactly 1)`);
  }
  const types = typesOf(s);
  const actual = jsonTypeOf(value);
  if (types && !types.includes(actual) && !(actual === 'integer' && types.includes('number'))) {
    errors.push(`${path}: expected ${types.join('|')}, got ${actual}`);
    return errors;
  }
  if (s.enum && !s.enum.some((e) => e === value)) errors.push(`${path}: ${JSON.stringify(value)} not in enum ${JSON.stringify(s.enum)}`);
  if (actual === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of s.required ?? []) if (!(key in obj)) errors.push(`${path}.${key}: required, missing`);
    for (const [key, sub] of Object.entries(s.properties ?? {})) {
      if (key in obj && obj[key] !== undefined) errors.push(...validate(sub, obj[key], defs, `${path}.${key}`));
    }
  }
  if (actual === 'array' && s.items) {
    (value as unknown[]).forEach((el, i) => errors.push(...validate(s.items as Schema, el, defs, `${path}[${i}]`)));
  }
  return errors;
}

/**
 * What a client built against `old` relies on that `next` no longer promises.
 * Additions (new optional properties, narrower types, fewer enum values,
 * new required properties) are safe and not reported.
 */
export function breakingChanges(old: Schema, next: Schema, oldDefs: Defs, nextDefs: Defs, path = '$', seen = new Set<string>()): string[] {
  const o = resolve(old, oldDefs);
  const n = resolve(next, nextDefs);
  const key = `${path}|${old.$ref ?? ''}|${next.$ref ?? ''}`;
  if (seen.has(key)) return [];
  seen.add(key);
  const out: string[] = [];

  const ot = typesOf(o);
  const nt = typesOf(n);
  if (nt && (!ot || nt.some((t) => !ot.includes(t) && !(t === 'integer' && ot.includes('number'))))) {
    out.push(`${path}: type widened ${ot ? ot.join('|') : 'any'} -> ${nt.join('|')}`);
  } else if (!nt && ot) {
    out.push(`${path}: type constraint ${ot.join('|')} removed`);
  }
  if (o.enum) {
    if (!n.enum) out.push(`${path}: enum ${JSON.stringify(o.enum)} removed`);
    else for (const v of n.enum) if (!o.enum.includes(v)) out.push(`${path}: new enum value ${JSON.stringify(v)}`);
  }
  const oReq = new Set(o.required ?? []);
  const nReq = new Set(n.required ?? []);
  for (const r of oReq) if (!nReq.has(r)) out.push(`${path}.${r}: no longer required`);
  for (const [prop, sub] of Object.entries(o.properties ?? {})) {
    const nsub = n.properties?.[prop];
    if (!nsub) out.push(`${path}.${prop}: property removed`);
    else out.push(...breakingChanges(sub, nsub, oldDefs, nextDefs, `${path}.${prop}`, seen));
  }
  if (o.items) {
    if (!n.items) out.push(`${path}[]: item schema removed`);
    else out.push(...breakingChanges(o.items, n.items, oldDefs, nextDefs, `${path}[]`, seen));
  }
  for (const combo of ['allOf', 'oneOf'] as const) {
    const oa = o[combo];
    if (!oa) continue;
    const na = n[combo];
    if (!na || na.length !== oa.length) {
      out.push(`${path}: ${combo} reshaped`);
      continue;
    }
    oa.forEach((sub, i) => out.push(...breakingChanges(sub, na[i], oldDefs, nextDefs, `${path}<${combo}${i}>`, seen)));
  }
  return out;
}

export interface RouteContract {
  method: string;
  path: string;
  note?: string;
  response: Schema;
}

export interface ContractFile {
  $defs: Defs;
  routes: Record<string, RouteContract>;
}

/** Breaking changes between two whole contract files, route by route. */
export function contractBreaks(old: ContractFile, next: ContractFile): string[] {
  const out: string[] = [];
  for (const [id, route] of Object.entries(old.routes)) {
    const nr = next.routes[id];
    if (!nr) {
      out.push(`${id}: route contract removed`);
      continue;
    }
    if (nr.method !== route.method || nr.path !== route.path) out.push(`${id}: moved ${route.method} ${route.path} -> ${nr.method} ${nr.path}`);
    out.push(...breakingChanges(route.response, nr.response, old.$defs, next.$defs, id));
  }
  return out;
}
