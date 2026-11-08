import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { podiumWorkbookSheets, type PodiumProduct } from '@/lib/podium/model';
import { writeXlsx, safeSheetNames } from '@/lib/xlsx/write';
import { readWorkbook } from '@/lib/xlsx/read';

const P = (id: string, sku: number, name: string, sort: number): PodiumProduct => ({
  id, sku, barcode: `76949310${sku}`.padEnd(12, '0'), name, dept: "ג'ל אנרגיה",
  url: null, imageUrl: null, price: 8, regularPrice: 9, deal: null, hidden: false, checkedAt: null, sort,
});
const ps = [P('a', 2, "ג'ל אנרגיה GU Gel Vanilla", 0), P('b', 11, "ג'ל אנרגיה GU Gel Salted Caramel", 1)];

describe('podium xlsx', () => {
  const orders = [
    { tab: 'yaya', items: { a: 3, b: 1 }, submittedAt: 'x', approval: 'none' as const },
    { tab: 'shalev', items: { a: 2 }, submittedAt: 'x', approval: 'none' as const },
    { tab: 'draft', items: { a: 9 }, submittedAt: null, approval: 'none' as const },
    { tab: 'no', items: { b: 9 }, submittedAt: 'x', approval: 'rejected' as const },
  ];
  it('builds Summary + a tab per sent runner, English-first names, numbers as numbers', () => {
    const bytes = writeXlsx(podiumWorkbookSheets(orders, ps));
    if (process.env.PODIUM_XLSX_OUT) writeFileSync(process.env.PODIUM_XLSX_OUT, bytes);
    const wb = readWorkbook(bytes);
    expect(wb.sheetNames).toEqual(['Summary', 'yaya', 'shalev']);
    expect(wb.sheets.Summary[0]).toEqual(['פריט', 'ברקוד', 'שם', 'שם מחלקה', 'כמות']);
    expect(wb.sheets.Summary[1]).toEqual([2, 769493102000, "GU Gel Vanilla ג'ל אנרגיה", "ג'ל אנרגיה", 5]);
    expect(wb.sheets.Summary[2][4]).toBe(1);
    expect(wb.sheets.shalev).toHaveLength(2);
  });
  it('keeps sheet names legal and unique', () => {
    expect(safeSheetNames(['a/b', 'A/B', 'x'.repeat(40)])).toEqual(['a b', 'A B (2)', 'x'.repeat(31)]);
  });
});
