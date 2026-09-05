// Puts pdf.js's worker where the browser can fetch it.
//
// pdf.js parses PDFs on a Web Worker and needs a URL for it. Bundling the worker
// through Next is fragile — a bare specifier can't be resolved by
// `new URL(..., import.meta.url)`, and the file has to survive both Turbopack and
// webpack — so it is copied into `public/` instead and loaded from `/…`.
//
// Copied at build time rather than committed, on the same reasoning as
// `public/sw.js`: a committed copy silently goes stale the moment `pdfjs-dist` is
// bumped, and a stale worker fails at a version check with an error nobody will
// connect to a dependency bump. The file is gitignored.
//
// If this ever doesn't run, PlanPdfViewer catches the load failure and falls back
// to the browser's own PDF viewer in an iframe, so a missing worker degrades
// instead of breaking the program page.

import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
// Resolve through the package rather than hardcoding node_modules — works the same
// under npm, a hoisted monorepo, or pnpm's symlinked store.
const pkg = require.resolve('pdfjs-dist/package.json');
const src = join(dirname(pkg), 'build', 'pdf.worker.min.mjs');
const destDir = join(process.cwd(), 'public');
const dest = join(destDir, 'pdf.worker.min.mjs');

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log(`[pdf-worker] ${src} -> ${dest}`);
