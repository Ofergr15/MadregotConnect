import { EU_SHOE_SIZES } from '@/lib/shoe-catalog';

/**
 * The trainee's side of the import (mockups/roles-1019/academy-import.html, screen 3): one page,
 * "הפרטים שלך", with what the academy's file already said filled in and editable, and only
 * what the file never had asked — birth date and gender — plus "still healthy?". Pure.
 */

export const GENDER_OPTIONS = ['גבר', 'אישה'] as const;
export const STILL_HEALTHY_YES = 'כן';
export const STILL_HEALTHY_CHANGED = 'השתנה';

export function genderColumn(v: unknown): 'male' | 'female' | null {
  return v === 'גבר' ? 'male' : v === 'אישה' ? 'female' : null;
}

function wholeDate(v: unknown): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v ?? ''));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? m[0] : null;
}

const numberIn = (v: unknown, lo: number, hi: number): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN;
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};

/**
 * The athlete columns the imported form fills (migrations 057/061/155), from its answers —
 * only values the columns' CHECKs accept, so one odd answer never fails the whole save.
 */
export function importProfileColumns(intake: Record<string, unknown> | null): Record<string, unknown> {
  if (!intake) return {};
  const out: Record<string, unknown> = {};
  const birth = wholeDate(intake.birthDate);
  if (birth) out.birth_date = birth;
  const gender = genderColumn(intake.gender);
  if (gender) out.gender = gender;
  const h = numberIn(intake.height, 100, 250);
  if (h != null) out.height_cm = Math.round(h);
  const w = numberIn(intake.weight, 25, 250);
  if (w != null) out.weight_kg = Math.round(w * 10) / 10;
  if (typeof intake.shirtSize === 'string' && ['XS', 'S', 'M', 'L', 'XL', 'XXL'].includes(intake.shirtSize)) out.shirt_size = intake.shirtSize;
  if (typeof intake.shoeSize === 'string' && EU_SHOE_SIZES.includes(intake.shoeSize)) out.shoe_size = intake.shoeSize;
  return out;
}

/** "050-123-4567" → "•••• 4567": the phone the file had, shown without showing it. */
export function maskPhone(phone: string | null | undefined): string {
  const d = String(phone ?? '').replace(/\D+/g, '');
  return d.length >= 4 ? `•••• ${d.slice(-4)}` : '';
}
