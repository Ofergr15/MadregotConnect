import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-heebo)', 'var(--font-inter)', 'sans-serif'],
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
      },
    },
  },
  plugins: [],
};

export default config;
