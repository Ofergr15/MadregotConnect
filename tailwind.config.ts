import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      // A HEIGHT breakpoint, not a width one. Every other screen in the app
      // scrolls, so only /register needs this: it is specified to fit on one
      // screen, and a 667px iPhone 6 is 177px shorter than the 844px it was drawn
      // at, which put the submit button below the fold. `short:` shrinks the
      // spacing there instead of letting the page start scrolling.
      screens: {
        short: { raw: '(max-height: 720px)' },
      },
      fontFamily: {
        sans: ['var(--font-heebo)', 'var(--font-inter)', 'sans-serif'],
      },
      // Named small steps to absorb the ~200 arbitrary sub-xs pixel sizes
      // (text-[9px]/[10px]/[11px]) into a consistent scale.
      //
      // `13`/`28` complete the DESIGN SCALE below: the designer's frames
      // use exactly 9 · 11 · 12 · 13 · 14 · 16 · 20 · 24 · 28, and Tailwind's
      // stock scale is missing 13 and 28 (its `3xl` is 30px, not 28). The 9 is
      // gone — see the floor rule below for why.
      // Numeric keys for the two plain pixel steps — `text-13` says what it is,
      // where a `xs+`-style name would not.
      // ── THE FLOOR: 11px for data, 10px for fixed labels, nothing below ──────
      //
      // The UI audit kept returning the same finding on screen after screen —
      // 188 items at 10px and 37 at 9px — and it is one decision, not 225 bugs.
      // The rule, decided 2026-09-22:
      //
      //   `2xs` (11px) is the FLOOR FOR DATA. Anything that renders differently
      //   each time gets decoded every time it is read: a run name, a year, a
      //   pace, a distance, a date, a count. That is where small type costs real
      //   information.
      //
      //   `3xs` (10px) is for FIXED LABELS only — copy that is read once and
      //   afterwards recognised by position and shape: the bottom-nav words, a
      //   chip's word, a table's column header, a stat caption, a unit suffix.
      //   Nobody is decoding "פרופיל" on the fifth day.
      //
      //   9px is GONE. There is no `4xs` token any more, so a new one cannot be
      //   added by autocomplete. All 37 sites moved on 2.40.120 by the same
      //   data/label split. The last nine were the program page's week table,
      //   which I expected to cost layout — seven day columns across 361px is
      //   why that table went to 9px in the first place. Measured on the real
      //   screen at 393px and 375px it costs nothing: no overflow, no
      //   truncation, and the full page grew 1698px → 1708px. The bar strip is
      //   the only seven-column structure; the day cards are full-width rows.
      //   "11.5+" at 11px is ~30px in a 46px column.
      //
      //   A FLOOR WRITTEN IN CLASS NAMES IS ONLY HALF A FLOOR. Three kinds of
      //   site never show up in a `text-4xs`/`text-3xs` grep, and all three were
      //   breaching it on 2.40.121:
      //     (a) arbitrary values — `text-[9px]`, `text-[8px]`. 24 of them, i.e.
      //         more than half again as many as the 37 the token grep found.
      //     (b) ARITHMETIC. ExecutionRing sizes its `%` at half the score's
      //         size, so a 48px ring printed it at SEVEN — the smallest type in
      //         the app. Its caption floored at `Math.max(8, …)`. Both now floor
      //         at 10.
      //     (c) SVG `fontSize` attributes. RouteMinimap's map attribution was 6;
      //         ExecutionQuality's chart labels were 8, 8 and 9.
      //   The audit catches all three, because it measures rendered pixels and
      //   does not read class names. Grep for `text-\[[0-9]` and `fontSize` when
      //   checking this rule, not just for the tokens.
      //
      //   TWO DELIBERATE EXCEPTIONS, both at 10px for content that is data:
      //   ImprovementChart's and ExecutionQuality's SVG ticks. An SVG tick is
      //   placed absolutely against the line or dot it labels, so a bigger glyph
      //   collides with its neighbour instead of reflowing. /register's
      //   `short:text-3xs` is not an exception — see the height breakpoint above.
      fontSize: {
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
          // WHITE-ON-GREEN. The same 3.30:1 the note below describes, from the other
          // direction: a solid `bg-accent-600` with a white label is 3.30:1 too, so
          // every filled green button in the app failed AA at 14px — including the
          // academy composer's send button, which is the one action that screen is
          // for. This is the fill those buttons use instead: 5.01:1 with white, and
          // close enough to 600 that a green pill still reads as the success colour.
          700: '#15803d',
          // TEXT-ON-TINT. The app's status-chip idiom sets `text-accent-600` on
          // `bg-accent-600/15`, i.e. a colour on a 15% wash of itself, which caps
          // the ratio at what the colour scores against near-white — 3.30:1 for
          // #16a34a, so every one of those chips failed AA. Darkening accent-600
          // itself was the wrong lever: to carry its own 20% wash it would have
          // to go to #0F5C2E, a forest green nothing like the success colour.
          // Instead the bright wash stays and only the LABEL darkens to this.
          // Clears 4.5:1 on every wash from 10%-over-card to 20%-over-page
          // (worst 5.68:1) and on the plain surfaces too, so it is also the right
          // value for an untinted `text-accent-900` caption.
          900: '#14532d',
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
        // ── The surfaces this ramp is measured against ──────────────────────
        // Walking all 43 screens and resolving each text run's EFFECTIVE
        // background (climbing ancestors and compositing alpha, because a
        // translucent surface reports its own background as transparent) turned
        // up five, not the two this comment used to name:
        //
        //   #FFFFFF  card                        45 runs
        //   #F5F5F5  card/90 over page           29
        //   #F2F2F2  card/60 over page           68
        //   #EFEFEF  card/50 over page          952   ← the common case
        //   #DFDFDF  page                       939   ← the binding case
        //
        // #EFEFEF and #F2F2F2 are not tokens: they are `bg-card/50` and
        // `bg-card/60` composited over `page`, which is how nearly every stat
        // tile and inset row in the app is built. So the ceiling for any text
        // colour here is set by #DFDFDF, and a value picked against #FFFFFF is
        // roughly a third of a ratio too light. Check both ends when changing
        // anything below 700.
        ink: {
          900: '#1D1E26', // darkest swatch in the palette strip
          700: '#2D2E38', // body text — the frames' default foreground
          500: '#4F4F4F', // muted (the "אוגוסט 2026" caption) — 6.15:1 on page
          // Secondary labels, placeholder copy, stat captions: 903 uses across
          // 115 files, so this one value decides whether most of the small text
          // in the app is legible. Was the design's #969696 (2.96:1 on white),
          // then #757575 — which clears 4.5:1 on white but measures only 3.46:1
          // on `page` and 4.01:1 on the card/50 tiles, i.e. it failed AA on the
          // 1,822 runs that make up almost all of the app's small text. That is
          // exactly the copy the club reads outdoors right after a run, at low
          // brightness. #5F5F5F is the lightest grey that clears 4.5:1 on ALL
          // five surfaces above (4.79:1 on the worst), with enough margin that
          // an extra translucent layer can't push it back under.
          400: '#5F5F5F', // 4.79:1 on page · 6.39:1 on card
          300: '#BBBBBB', // outline-pill border, hairlines — 1.92:1, borders only
        },
        page: '#DFDFDF', // page background AND the inner stat tiles on a card
        card: '#FFFFFF', // every raised surface
        // The workout-type red the frames use for `Intervals`. Deeper than
        // WORKOUT_TYPE_COLORS.intervals (#ef4444), which stays as-is because the
        // dark screens share it.
        //
        // Deepened from the frames' #D74E4E, which failed AA at both ends: it
        // measured 4.13:1 as 14–15px text on card (145 `text-accent-red` uses,
        // including התנתקות on every screen with a header) and gave the same
        // 4.13:1 to the white text sitting on the 28 solid `bg-accent-red`
        // fills. One value governs both, since white-on-red and red-on-white
        // share the ratio, so darkening fixes the destructive buttons and the
        // error copy together. Kept on the frames' hue and saturation.
        'accent-red': '#AD3838', // 6.18:1 on card · 4.64:1 on page
        // TEXT-ON-TINT companion, same role as accent-900 and band-N-ink below.
        //
        // CORRECTED 2026-09-22 — this comment used to say `bg-accent-red/15` over
        // the page tint composites to #D7C6C6 and drops #AD3838 to 3.76:1 (4.04:1
        // at /10), "which is every error box and destructive chip in the app".
        // That is wrong, and it was about to cost a thirty-file sweep. Measured by
        // compositing the rgba in a canvas and reading the pixel back, rather than
        // by hand: /15 over the page tint is #E8D7DA, not #D7C6C6. #D7C6C6 needs
        // alpha ~0.37 AND a greyer base than `page` (it has G == B, where a real
        // composite over #F2F4F7 keeps B > G). The 3.76 figure is arithmetically
        // consistent with #D7C6C6 — it is the composite that was wrong.
        //
        // What #AD3838 actually measures as small text:
        //
        //            on white card   on page tint
        //   /10          5.31            4.83
        //   /12          5.14            4.67
        //   /15          4.90            4.46  <- fails, by 0.04
        //   /20          4.52            4.13  <- fails
        //   no wash      6.18            5.61
        //
        // So the error boxes were fine all along. Only `/20` is genuinely exposed,
        // and note WHY: it clears on a card by 0.02 and fails on the page, so
        // whether `bg-accent-red/20 text-accent-red` is legal depends on a
        // container the class string cannot see. The seven `/20` sites use this
        // companion for that reason — not because red-on-tint is broken, but to
        // remove a correctness-depends-on-the-parent trap. /10 through /15 keep
        // the plain token; do not "finish" the sweep.
        'accent-red-ink': '#8F2B2B', // 6.03:1 on its own /20 over card, 5.51:1 over page
        // The three דבוקה tints on the league table, read off the frame's
        // rgba() row fills. Squad colour still comes from resolveGroup() at
        // runtime; these are the design's reference values.
        band: {
          1: '#1525FF',
          2: '#159AFF',
          3: '#FF5315',
          // TEXT-ON-TINT companions — see the note on `accent.900`. These exist
          // so the frames' דבוקה colours above stay EXACTLY as delivered: the row
          // fills and the `bg-band-N/15` chips keep the designer's hue, and only
          // the label on top of them darkens. Repainting band-2/band-3 to carry
          // their own washes would have meant #0B5285 and #8A2B08 as the squad
          // colours themselves, which is a brand change and not mine to make.
          // Same hue, dropped in lightness until they clear 4.5:1 on the darkest
          // wash the app produces (20% over `page`): 5.19:1 and 5.28:1.
          '2-ink': '#0B5285',
          '3-ink': '#8A2B08',
        },
      },
    },
  },
  plugins: [],
};

export default config;
