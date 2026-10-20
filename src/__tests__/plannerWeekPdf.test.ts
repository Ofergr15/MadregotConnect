import { describe, expect, it } from 'vitest';
import { isPdf, weekNumberFor } from '@/lib/plans/week-pdf';

/** The planner's PDF becomes the week's training PDF (2026-10-20: 18.10 had none). */
describe('the week number for a new PDF', () => {
  const rows = [
    { week_number: 14, week_start_date: '2026-10-11', training_pdf_url: 'x' },
    { week_number: 13, week_start_date: '2026-09-20', training_pdf_url: 'y' },
  ];
  it('is one after the last week before it', () => expect(weekNumberFor(rows, '2026-10-18')).toBe(15));
  it('is the week\'s own when it has a row', () => expect(weekNumberFor(rows, '2026-10-11')).toBe(14));
  it('starts at 1 with nothing before', () => expect(weekNumberFor([], '2026-10-18')).toBe(1));
});

describe('which uploads are a PDF', () => {
  it('by type or by name; an image is not', () => {
    expect(isPdf(new File(['%PDF'], 'week.pdf', { type: 'application/pdf' }))).toBe(true);
    expect(isPdf(new File(['%PDF'], 'WEEK.PDF', { type: '' }))).toBe(true);
    expect(isPdf(new File(['x'], 'plan.jpg', { type: 'image/jpeg' }))).toBe(false);
    expect(isPdf(null)).toBe(false);
  });
});
