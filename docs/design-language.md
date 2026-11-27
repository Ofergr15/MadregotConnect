# Web design language

One page describing the visual system the web app (and the native app's "quiet" style)
share. The values live in **`tailwind.config.ts`** (tokens) and are mirrored as CSS
variables in **`src/app/globals.css`** (`:root { --mg-* }`) for inline styles, SVG and
canvas code. If you need a colour that is not here, add a token — don't write a hex.

## Surfaces

| Role | Token | CSS var | Value |
|---|---|---|---|
| Page background (light) | `bg-page` | `--mg-page` | `#DFDFDF` |
| Raised surface / card | `bg-card` | `--mg-card` | `#FFFFFF` |
| Card radius | `rounded-card` | — | 25px |
| Pill radius | `rounded-pill` | — | 50px |
| Inner tile radius | `rounded-tile` | — | 5px |

The page is light; every raised surface is a white card on the grey page. Inner stat
tiles sit on `bg-page` (or `bg-card/50`) inside the card. No dark surfaces except the
watch / map chrome that is intentionally device-like.

## Colour

| Role | Token | CSS var | Value |
|---|---|---|---|
| Brand blue — headings, fills, active pills, primary CTA | `brand` / `brand-600` | `--mg-brand` | `#1525FF` |
| Brand pressed | `brand-700` | `--mg-brand-pressed` | `#0F1CCC` |
| Orange — secondary accent, badges, group 3 | `orange` | `--mg-orange` | `#FF5315` |
| Ink — darkest text | `ink-900` | `--mg-ink` | `#1D1E26` |
| Body text | `ink-700` | `--mg-ink-body` | `#2D2E38` |
| Muted text (AA on page) | `ink-500` / `ink-400` | — | `#4F4F4F` / `#5F5F5F` |
| Hairlines, outline-pill borders only | `ink-300` | — | `#BBBBBB` |
| Success / error | `accent-*`, `accent-red` | — | see config comments for AA notes |

`primary-*` (`#4338ff` indigo) is the older ramp; new UI uses `brand`. Don't mix the two
on one screen.

### Group colours

Never re-derive. `resolveGroup(name)` in `src/lib/utils.ts` returns `index`, display
name, level and `hex`/`colors`; use it for every chip, row tint and map line. The
league-table tints are `band-1/2/3` with `band-2-ink` / `band-3-ink` for text on their
washes.

## Type

Heebo; body is light (300), emphasis bold (700). Small sizes are `text-3xs` (10px,
data ticks only), `text-2xs` (11px), `text-13`. Nothing under 10px.

## Rules

1. No hardcoded hex in `src/components/**` class names — use the tokens above
   (`bg-brand`, `text-orange`, `text-ink-900`). Inline styles use `var(--mg-*)`.
2. Greys: use the `ink-*` ramp and `page`/`card`. Tailwind's `gray-*`/`slate-*`
   are legacy; replace them when you touch a component.
3. Contrast: text must clear 4.5:1 on its actual background (see the AA notes in
   `tailwind.config.ts` — tinted chips use the `*-ink` companions).
4. RTL first: logical properties (`ms-`, `pe-`, `text-start`), never `left`/`right`.
