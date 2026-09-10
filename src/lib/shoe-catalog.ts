/**
 * The club's HOKA line-up, as a picklist.
 *
 * The shoe tracker only ever had a free-text name field, so the same model
 * arrived spelled six ways ("mach7", "Mach 7", "מאך 7") and none of them could be
 * grouped, compared, or recommended against. This is the fixed list; the text
 * field stays alongside it, because an athlete running in something else must
 * still be able to log it.
 *
 * `suggestedLimitKm` is a STARTING POINT for the retirement alert, not a
 * manufacturer figure — nobody publishes those. It follows the one thing that
 * genuinely predicts foam life here: a carbon-plated racing shoe is ridden for a
 * fraction of the distance a max-cushioned recovery trainer is. The athlete can
 * change it on the same screen, and the number is only ever prefilled, never
 * enforced.
 *
 * Grouped by PURPOSE rather than by model line, because that is the question an
 * athlete is actually answering when they add a pair.
 */

/**
 * EU shoe sizes for the profile field, half-size steps, 36–50.
 *
 * Lives here rather than inside the profile component so its bounds are testable:
 * it stopped at 46 and a member reported having no size to pick (2026-09-08).
 * Replacing a free-text field with a picklist is what made that possible, so the
 * range is now something a test asserts rather than something a component holds.
 */
export const EU_SHOE_SIZES: string[] = Array.from({ length: 29 }, (_, i) =>
  (36 + i * 0.5).toString().replace(/\.0$/, ''),
);

export type ShoeSurface = 'road' | 'trail';

export type ShoeCatalogEntry = {
  brand: 'HOKA';
  model: string;
  surface: ShoeSurface;
  /** Carbon-plated. Kept as data, not prose, so it can be filtered on later. */
  carbon: boolean;
  /** One-line Hebrew purpose, shown under the model name in the picker. */
  purpose: string;
  suggestedLimitKm: number;
};

export type ShoeCatalogGroup = {
  id: string;
  label: string;
  models: ShoeCatalogEntry[];
};

const road = (
  model: string,
  carbon: boolean,
  purpose: string,
  suggestedLimitKm: number,
): ShoeCatalogEntry => ({ brand: 'HOKA', model, surface: 'road', carbon, purpose, suggestedLimitKm });

const trail = (
  model: string,
  carbon: boolean,
  purpose: string,
  suggestedLimitKm: number,
): ShoeCatalogEntry => ({ brand: 'HOKA', model, surface: 'trail', carbon, purpose, suggestedLimitKm });

export const SHOE_CATALOG: ShoeCatalogGroup[] = [
  {
    id: 'road-racing',
    label: 'מרוצי כביש',
    models: [
      road('Cielo X1 3.0', true, 'קרבון · המהירה ביותר', 400),
      road('Rocket X 3', true, 'קרבון · מהירה ומאוזנת', 450),
    ],
  },
  {
    id: 'fast-training',
    label: 'אימונים מהירים',
    models: [
      road('Clifton PRO', false, 'טמפו ואימונים מהירים · ללא קרבון', 700),
      road('Mach 7', false, 'עבודת קצב ומהירות · קלה וזריזה', 650),
    ],
  },
  {
    id: 'daily',
    label: 'ריצות יומיום',
    models: [road('Clifton 11', false, 'נוחה ומאוזנת לכל יום', 800)],
  },
  {
    id: 'easy-recovery',
    label: 'ריצות קלות והתאוששות',
    models: [road('Bondi 9', false, 'ריפוד מקסימלי', 900)],
  },
  {
    id: 'fast-trail',
    label: 'שטח מהיר',
    models: [trail('Rocket X Trail', true, 'קרבון · שבילים זורמים וחצץ', 500)],
  },
  {
    id: 'technical-trail',
    label: 'שטח טכני',
    models: [trail('Tecton X 4', true, 'קרבון · אחיזה והגנה בשטח קשה', 550)],
  },
];

/** Every model, flattened — for lookups and for tests that must cover them all. */
export const SHOE_CATALOG_ENTRIES: ShoeCatalogEntry[] = SHOE_CATALOG.flatMap((g) => g.models);

/** What gets stored as the shoe's name: brand included, so a row reads on its own. */
export function catalogShoeName(entry: ShoeCatalogEntry): string {
  return `${entry.brand} ${entry.model}`;
}

/**
 * Which catalogue model, if any, a stored shoe name refers to.
 *
 * Deliberately forgiving: shoes added before this list existed are plain text
 * typed by hand, and they should still light up as the model they are rather than
 * looking like something the app has never heard of. So the brand prefix is
 * optional, case is ignored, and runs of whitespace collapse — "mach 7",
 * "HOKA  Mach 7" and "Mach 7" are one shoe.
 *
 * Not fuzzy beyond that. "Mach 6" is a different shoe from "Mach 7" and must not
 * quietly inherit its limit.
 */
export function findCatalogShoe(name: string | null | undefined): ShoeCatalogEntry | null {
  if (!name) return null;
  const key = normalize(name);
  if (!key) return null;
  return (
    SHOE_CATALOG_ENTRIES.find(
      (e) => key === normalize(e.model) || key === normalize(catalogShoeName(e)),
    ) ?? null
  );
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}
