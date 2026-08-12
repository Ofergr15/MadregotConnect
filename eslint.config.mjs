import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';

export default defineConfig([
  ...nextVitals,
  {
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
    rules: {
      '@next/next/no-img-element': 'off',
      '@next/next/no-location-assign-relative-destination': 'off',
      'jsx-a11y/alt-text': 'off',
      // React 19's compiler-oriented rules flag long-standing state/effect
      // patterns across the existing app. Keep the pre-upgrade lint contract;
      // migrate those patterns incrementally instead of blocking Next 16.
      'react-hooks/immutability': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/static-components': 'off',
    },
  },
  globalIgnores([
    '.next/**',
    'node_modules/**',
    'public/sw.js',
    '.supabase-sandbox/**',
  ]),
]);
