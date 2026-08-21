import { createSerwistRoute } from '@serwist/turbopack';

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    additionalPrecacheEntries: [{ url: '/offline.html', revision: null }],
    swSrc: 'src/app/sw.ts',
    useNativeEsbuild: true,
    // Keep the precache manifest to app-shell-sized files. Without this, every
    // visitor's browser downloads the full manifest (incl. rarely-used
    // features) in the background on install, and re-downloads it in full on
    // every deploy. Right now the only files anywhere near this size are the
    // run-chat feature's stream-chat-react bundle (~1.75MiB) and its AI-coach
    // avatar image (~1.98MiB) -- both used only by visitors who open chat.
    // 1MiB sits well above every core app-shell chunk (the largest is
    // ~408KiB) and well below both of those, so this only drops run-chat's
    // assets; core JS/CSS, the manifests, and `/offline.html` are untouched.
    // (`self.__SW_MANIFEST` in sw.ts is a plain `{url, revision}` array with
    // no size info, so this can only be done here, at manifest-generation
    // time, not in the worker itself.)
    maximumFileSizeToCacheInBytes: 1024 * 1024,
  });
