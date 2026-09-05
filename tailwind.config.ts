import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-heebo)', 'var(--font-inter)', 'sans-serif'],
      },
      // Named small steps to absorb the ~200 arbitrary sub-xs pixel sizes
      // (text-[9px]/[10px]/[11px]) into a consistent scale.
      //
      // `4xs`/`13`/`28` complete the DESIGN SCALE below: the designer's frames
      // use exactly 9 · 11 · 12 · 13 · 14 · 16 · 20 · 24 · 28, and Tailwind's
      // stock scale is missing 9, 13 and 28 (its `3xl` is 30px, not 28).
      // Numeric keys for the two plain pixel steps — `text-13` says what it is,
      // where a `xs+`-style name would not.
      fontSize: {
        '4xs': ['9px', { lineHeight: '12px' }],
        '3xs': ['10px', { lineHeight: '13px' }],
        '2xs': ['11px', { lineHeight: '14px' }],
        '13': ['13px', { lineHeight: '17px' }],
        '28': ['28px', { lineHeight: '34px' }],
      },
      // ═══ DESIGN SCALE — the designer's frames use only these three radii:
      // 25px cards, 50px pills, 5px inner tiles. Named so a card is
      // `rounded-card`, not a magic number repeated across every component.
      borderRadius: {
        card: '25px',
        pill: '50px',
        tile: '5px',
      },
      colors: {
        // Brand ramp anchored on the REAL Madregot indigo (#4338ff — matches
        // manifest theme_color and the ~192 hardcoded uses). Previously `600`
        // was Tailwind's stock indigo #4F46E5, so token-based UI and hardcoded
        // #4338ff shipped as two visibly different indigos on the same screen.
        primary: {
          50: '#EEEDFF',
          100: '#E0DEFF',
          200: '#C4C0FF',
          300: '#A29CFF',
          400: '#818CF8',
          500: '#5B54FF',
          600: '#4338ff',
          700: '#3730d4',
          800: '#2C27A8',
          900: '#221E80',
        },
        accent: {
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
        },

        // ═══════════════════════════════════════════════════════════════════
        // THE NEW DESIGN SYSTEM — from the designer's Figma frames (Profile +
        // Feed, delivered 2026-09-02 as "Copy as CSS" dumps). Every value here
        // is lifted verbatim from those dumps; none of it is invented.
        //
        // This is the app's design language going forward: light surfaces, one
        // electric blue, Heebo at weights 300/700 only. It is deliberately
        // ADDITIVE and does not touch `primary` above — the ~192 hardcoded
        // #4338ff uses and the 40-odd screens still on the dark palette keep
        // rendering exactly as they do today, and each one converts when its
        // frame arrives. Do NOT re-anchor `primary` on #1525FF as a shortcut:
        // that repaints every unconverted screen's accent while its hardcoded
        // #4338ff siblings stay put, which is the two-different-indigos bug the
        // comment above records having already been fixed once.
        // ═══════════════════════════════════════════════════════════════════
        brand: {
          600: '#1525FF', // the frames' primary — headings, fills, active pills
          700: '#0F1CCC', // pressed state (derived; the frames show no press)
          DEFAULT: '#1525FF',
        },
        // Text ramp. `ink` is body copy, descending to the hairline used for
        // outline pills. Numbered high→low like a Tailwind ramp so the darker
        // the number, the darker the ink.
        //
        // Everything down to 400 is used as text on #FFF or #DFDFDF and must
        // clear WCAG AA (4.5:1). 300 is a border value and deliberately does
        // not — contrast rules do not apply to hairlines. Anything added below
        // 400 should be a border, not text.
        ink: {
          900: '#1D1E26', // darkest swatch in the palette strip
          700: '#2D2E38', // body text — the frames' default foreground
          500: '#656565', // muted (the "אוגוסט 2026" caption) — 5.83:1
          // Secondary labels, placeholder copy, stat captions: 903 uses across
          // 115 files, so this one value decides whether most of the small text
          // in the app is legible. Was the design's #969696, which measures
          // 2.96:1 on white and fails AA even at large sizes — unreadable in
          // sunlight and at low brightness, which is exactly when the club reads
          // it (outdoors, right after a run). #757575 is the lightest grey that
          // clears 4.5:1, chosen over collapsing into ink-500 so the gap between
          // primary and secondary text survives.
          400: '#757575', // 4.60:1
          300: '#BBBBBB', // outline-pill border, hairlines — 1.92:1, borders only
        },
        page: '#DFDFDF', // page background AND the inner stat tiles on a card
        card: '#FFFFFF', // every raised surface
        // The workout-type red the frames use for `Intervals`. Slightly deeper
        // than WORKOUT_TYPE_COLORS.intervals (#ef4444), which stays as-is
        // because the dark screens share it.
        'accent-red': '#D74E4E',
        // The three דבוקה tints on the league table, read off the frame's
        // rgba() row fills. Squad colour still comes from resolveGroup() at
        // runtime; these are the design's reference values.
        band: {
          1: '#1525FF',
          2: '#159AFF',
          3: '#FF5315',
        },
      },
    },
  },
  plugins: [],
};

export default config;
