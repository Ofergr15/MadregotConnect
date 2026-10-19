import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { GROUP_DISPLAY, GROUP_TINT, groupTag } from '@/lib/academy/intake-display';
import { IntakeAnswers, IntakeTags } from '@/components/AcademyRegistrations';
import { StageLine } from '@/components/academy/CandidateFunnel';
import { candidateTimeline } from '@/lib/academy/funnel';

/**
 * academy-form-v3.html: the restyled form and the manager's card. The stored answers must
 * not move — only how they are drawn — so most of this pins the seam between the two.
 */

const root = join(__dirname, '..', '..');
const form = readFileSync(join(root, 'src/app/academy-register/page.tsx'), 'utf8');
const fields = form.slice(form.indexOf('const FIELDS'), form.indexOf('const FULL_STEPS'));
const steps = form.slice(form.indexOf('const FULL_STEPS'), form.indexOf('const FIELD_BY_KEY'));

const groupOptions = (() => {
  const block = fields.slice(fields.indexOf("key: 'group'"), fields.indexOf("key: 'runningHistory'"));
  return [...block.matchAll(/'(דבוקה [^']+)'/g)].map(m => m[1]);
})();

describe('the v3 form', () => {
  it('draws every pack the form stores, with a tint, and stores the same strings as before', () => {
    expect(groupOptions).toHaveLength(6);
    for (const option of groupOptions) {
      const d = GROUP_DISPLAY[option];
      expect(d, `no v3 row for "${option}"`).toBeTruthy();
      expect(GROUP_TINT[d.n]).toBeTruthy();
      // The number on the badge is the number the stored answer starts with.
      expect(option.startsWith(`דבוקה ${d.n} `)).toBe(true);
    }
    // The pick stores the option itself, never the display name.
    expect(form).toContain('onPick={() => set(f.key, opt)}');
  });

  it('asks "מה מדבר אליך יותר" on the first page, and keeps all twenty questions', () => {
    const first = steps.split('\n').find(l => l.includes("title: 'הפרטים שלך'"))!;
    expect(first).toContain("'focus'");
    const asked = [...steps.matchAll(/'([a-zA-Z]+)'/g)].map(m => m[1]).filter(k => fields.includes(`key: '${k}'`));
    expect(new Set(asked).size).toBe(20);
  });

  it('works the page\'s problem out live, so a fixed field stops being reported', () => {
    // The bug: "אנא מלא/י: שם פרטי" stayed on screen after the name was typed, because
    // the message was a string frozen at the moment המשך was pressed.
    expect(form).toContain('const problem = tried === step ? problemOn(step) : null;');
    expect(form).not.toMatch(/setError\(problem\)/);
  });

  it('has the logo, the step count and the pinned buttons', () => {
    expect(form).toContain('src="/images/logo.png"');
    expect(form).toContain('Madregot Academy');
    expect(form).toContain("'לשלוח'");
    expect(form).toContain('חזרה');
  });
});

describe('groupTag', () => {
  it('shortens a known pack and passes an old wording through', () => {
    expect(groupTag('דבוקה 7 הכנה לחצי מרתון')).toBe('דבוקה 7 · חצי מרתון');
    expect(groupTag('דבוקה 12 משהו אחר')).toBe('דבוקה 12 משהו אחר');
    expect(groupTag(undefined)).toBe('');
  });
});

describe('the grouped answers', () => {
  const intake = {
    firstName: 'נועה', lastName: 'לוי',
    focus: 'שילוב של תכנית און ליין עם מפגשים פיזיים',
    birthDate: '1990-03-12', weight: '58.5', height: '165', city: 'תל אביב',
    group: 'דבוקה 7 הכנה לחצי מרתון',
    runningHistory: 'רצה 3 פעמים בשבוע',
    medicalHistory: 'היו בעיות עבר שאינן כרגע', medicalDetails: 'שין ספלינט',
    hearAbout: 'אחר', hearAboutOther: 'חברה מהעבודה',
    shirtSize: 'S', pantsSize: 'M', tightsSize: 'S', shoeSize: '38.5',
  };

  it('sorts them under the five headings and lists the skipped ones last', () => {
    const html = renderToStaticMarkup(<IntakeAnswers intake={intake} phone="052-555-1234" email="noa@example.com" cityInHeader />);
    const order = ['הריצה', 'בריאות', 'עליו/ה', 'מידות לערכה', 'פרטי קשר', 'לא ענה/תה'].map(h => html.indexOf(`>${h}<`));
    expect(order.every(i => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('חברה מהעבודה');
    // achievements was skipped: it is in the grey list, and nowhere else.
    const skipped = html.slice(html.indexOf('>לא ענה/תה<'));
    expect(skipped).toContain('הישגים');
    expect(skipped).not.toContain('משקל');
  });

  it('flags a medical answer in yellow, and not "בריא לחלוטין"', () => {
    expect(renderToStaticMarkup(<IntakeTags intake={intake} />)).toContain('עבר רפואי');
    expect(renderToStaticMarkup(<IntakeTags intake={{ ...intake, medicalHistory: 'בריא לחלוטין' }} />)).not.toContain('עבר רפואי');
  });
});

describe('the nine dots', () => {
  const card = { id: 'c', name: 'נועה לוי', createdAt: '2026-10-10T08:00:00Z' };
  const at = (stage: string) => ({ candidateId: 'c', stage, occurredAt: '2026-10-11T08:00:00Z' });

  it('marks the current step and keeps the standing order grey even when it is next', () => {
    const html = renderToStaticMarkup(<StageLine steps={candidateTimeline(card, [at('form')])} />);
    expect(html).toContain('aria-label="שיחת היכרות: השלב הנוכחי"');
    const all = ['form', 'intro_call', 'characterization', 'signup', 'test', 'analysis', 'first_plan', 'whatsapp'].map(at);
    const end = renderToStaticMarkup(<StageLine steps={candidateTimeline(card, all)} />);
    expect(end).toContain('aria-label="הוראת קבע: עוד לא"');
    expect(end).not.toContain('aria-current');
  });
});
