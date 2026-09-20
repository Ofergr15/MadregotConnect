import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The payments screen's wiring, asserted by reading the source.
 *
 * No @testing-library/react in this repo, so component behaviour is guarded the way the other
 * academy screens guard it. The lib and the route have their own tests; what only the screen can
 * get wrong is sending something, counting something twice, or promising a receipt.
 */

const read = (file: string) => readFileSync(join(process.cwd(), 'src', file), 'utf8');
const screen = read('components/academy/AcademyPayments.tsx');
const page = read('app/(app)/dashboard/academy/page.tsx');
const route = read('app/api/academy/payments/route.ts');

describe('the screen sends nothing', () => {
  it('a reminder is words to copy, not a message the app delivers', () => {
    // A reminder about money is the most relationship-sensitive thing in the academy, it goes out
    // over WhatsApp today, and whether the app should ever send one is an open question. So the
    // pill opens the text and the clipboard is the only outward thing that happens.
    expect(screen).toContain('paymentReminderText');
    expect(screen).toContain('navigator.clipboard');
    expect(screen).toContain('האפליקציה לא שולחת הודעות על כספים');
  });

  it('has no send route and no notification behind it', () => {
    expect(screen).not.toContain('/api/academy/dispatch');
    expect(screen).not.toContain('scheduled_notifications');
    expect(route).not.toContain('scheduled_notifications');
    expect(route).not.toContain('getStreamServerClient');
  });
});

describe('what the screen refuses to claim', () => {
  it('says the money stays in GO, on the screen and not only in a migration comment', () => {
    // The single most likely way this feature does damage is somebody treating a marked month as
    // proof of payment.
    expect(screen).toContain('הכסף עצמו נשאר ב-GO');
    expect(screen).toContain('זו לא הנהלת חשבונות ולא אישור תשלום');
  });

  it('names the migration when the tables are not there', () => {
    expect(screen).toContain("body?.tableMissing) { setData(body); setState('missing')");
    expect(screen).toContain('115');
  });

  it('shows a gap instead of a zero for a mentor with no recorded rate', () => {
    expect(screen).toContain('p.rateMissing ?');
    expect(screen).toContain('לא הוגדר');
  });

  it('labels the per-trainee breakdown as an average over the fees it actually has', () => {
    expect(screen).toContain('economicsBasis');
    expect(screen).toContain('feesRecorded');
  });
});

describe('counts and lists come from one place', () => {
  it('reads every KPI off the computed board rather than filtering rows again', () => {
    // The failure mode this prevents is a footer saying two above a list of three.
    for (const key of ['board.kpi.activeStandingOrders', 'board.kpi.unpaid', 'board.kpi.awaitingLink', 'board.needsAttention']) {
      expect(screen).toContain(key);
    }
    // No second opinion about who is in trouble: the component never re-derives the lists.
    expect(screen).not.toContain("rows.filter(r => r.needsAttention)");
  });

  it('draws both lists the board produced', () => {
    expect(screen).toContain('board.unpaid.map');
    expect(screen).toContain('board.paid.map');
    expect(screen).toContain('board.freeRiders.map');
  });
});

describe('one tap per state', () => {
  it('offers a paid month an undo, not a second marking', () => {
    expect(screen).toContain("row.state === 'paid' ?");
    expect(screen).toContain('בטל סימון');
  });

  it('offers a link to somebody who has never had one, and a reminder to somebody who has', () => {
    // A failed standing order needs a phone call and not another link; somebody with no link yet
    // needs a link and not a reminder about one nobody sent.
    expect(screen).toContain("row.state === 'awaiting_link' ?");
    expect(screen).toContain('סמן: נשלח קישור');
    expect(screen).toContain('נוסח תזכורת');
  });
});

describe('who reaches the screen', () => {
  it('is a manager-only tab, and the route refuses everybody else regardless', () => {
    expect(page).toContain("value: 'payments' as Tab");
    expect(page.slice(page.indexOf("value: 'payments' as Tab") - 200, page.indexOf("value: 'payments' as Tab")))
      .toContain('isManager');
    expect(route).toContain("caller.role === 'admin'");
    expect(route).toContain('Manager access required');
  });

  it('carries no badge, so no other tab pays for a manager-only fetch', () => {
    const tab = page.slice(page.indexOf("value: 'payments' as Tab"));
    expect(tab.slice(0, tab.indexOf('\n'))).not.toContain('badge');
  });
});
