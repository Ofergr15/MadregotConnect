import { describe, expect, it } from 'vitest';
import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import he from '../../messages/he.json';
import en from '../../messages/en.json';

/**
 * Deeper than messagesLocaleParity (same keys, same argument NAMES): every message
 * must parse the way next-intl parses it at render time, and both locales must agree
 * on what each argument IS and which rich tags the caller has to supply.
 *
 * next-intl parses with tags on, so a literal `<ID>` in prose is an unclosed tag: the
 * render throws, next-intl logs it and shows the key path ("practice.editVideosHint")
 * instead of the sentence — no typecheck or build notices. That was live in en.json.
 *
 * Not compared on purpose: the OPTIONS of a select. Hebrew conjugates by gender
 * (`{gender, select, female {…} male {…} other {…}}`) where English needs one form,
 * so he.json legitimately has more branches.
 */

type Tree = { [k: string]: string | string[] | Tree };
const flatten = (tree: Tree, prefix = ''): [string, string][] =>
  Object.entries(tree).flatMap(([k, v]) => {
    if (Array.isArray(v)) return v.map((s, i): [string, string] => [`${prefix}${k}[${i}]`, s]);
    if (v && typeof v === 'object') return flatten(v, `${prefix}${k}.`);
    return [[`${prefix}${k}`, v]];
  });

const HE = new Map(flatten(he as unknown as Tree));
const EN = new Map(flatten(en as unknown as Tree));

function tryParse(message: string): MessageFormatElement[] | string {
  try {
    return parse(message);
  } catch (e) {
    return (e as Error).message;
  }
}

/** `name:kind` for every argument (plural/select/number/date/time/plain), and every tag. */
function shape(ast: MessageFormatElement[], args = new Set<string>(), tags = new Set<string>(), noOther: string[] = []) {
  for (const el of ast) {
    switch (el.type) {
      case TYPE.argument: args.add(`${el.value}:arg`); break;
      case TYPE.number: args.add(`${el.value}:number`); break;
      case TYPE.date: args.add(`${el.value}:date`); break;
      case TYPE.time: args.add(`${el.value}:time`); break;
      case TYPE.plural:
      case TYPE.select:
        args.add(`${el.value}:${el.type === TYPE.plural ? 'plural' : 'select'}`);
        if (!('other' in el.options)) noOther.push(el.value);
        for (const o of Object.values(el.options)) shape(o.value, args, tags, noOther);
        break;
      case TYPE.tag:
        tags.add(el.value);
        shape(el.children, args, tags, noOther);
        break;
      default:
    }
  }
  return { args: [...args].sort(), tags: [...tags].sort(), noOther };
}

describe.each([['he', HE], ['en', EN]] as const)('messages/%s.json', (_locale, messages) => {
  it('every message parses as ICU with tags on (as next-intl renders it)', () => {
    const broken = [...messages].flatMap(([k, m]) => {
      const ast = tryParse(m);
      return typeof ast === 'string' ? [`${k}: ${ast}`] : [];
    });
    expect(broken).toEqual([]);
  });

  it('every plural and select has an `other` branch (ICU requires it; a missing one throws)', () => {
    const missing = [...messages].flatMap(([k, m]) => {
      const ast = tryParse(m);
      return typeof ast === 'string' ? [] : shape(ast).noOther.map((a) => `${k}: {${a}}`);
    });
    expect(missing).toEqual([]);
  });
});

describe('he ↔ en agree per key', () => {
  const pairs = [...HE].filter(([k]) => EN.has(k)).map(([k, h]) => [k, tryParse(h), tryParse(EN.get(k)!)] as const)
    .filter((p): p is readonly [string, MessageFormatElement[], MessageFormatElement[]] => typeof p[1] !== 'string' && typeof p[2] !== 'string');

  it('the same argument is the same kind in both (a plural in one is not a plain {n} in the other)', () => {
    const drift = pairs.flatMap(([k, h, e]) => {
      const a = shape(h).args.join(','); const b = shape(e).args.join(',');
      return a === b ? [] : [`${k}: he[${a}] en[${b}]`];
    });
    expect(drift).toEqual([]);
  });

  it('the same rich tags in both (t.rich needs a handler for each; an unhandled one throws)', () => {
    const drift = pairs.flatMap(([k, h, e]) => {
      const a = shape(h).tags.join(','); const b = shape(e).tags.join(',');
      return a === b ? [] : [`${k}: he<${a}> en<${b}>`];
    });
    expect(drift).toEqual([]);
  });
});

describe('the checks catch what they claim to', () => {
  it('a literal <ID> in prose is a parse error; quoting it is not', () => {
    expect(typeof tryParse('from the link: /file/d/<ID>/view')).toBe('string');
    expect(typeof tryParse("from the link: /file/d/'<ID>'/view")).not.toBe('string');
  });
  it('kind drift and a missing `other` are seen', () => {
    expect(shape(parse('{n, plural, one {a} other {b}}')).args).toEqual(['n:plural']);
    expect(shape(parse('{n} runs')).args).toEqual(['n:arg']);
    expect(shape(parse('<b>{x}</b>')).tags).toEqual(['b']);
  });
});
