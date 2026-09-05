import { createSerwistRoute } from '@serwist/turbopack';

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    // /offline.html lives in public/, so @serwist/turbopack already precaches
    // it automatically with a real content hash — adding it again here (as
    // this used to) creates a second entry for the same URL with a mismatched
    // (null) revision, which throws add-to-cache-list-conflicting-entries at
    // SW install time on real devices.
    swSrc: 'src/app/sw.ts',
    useNativeEsbuild: true,
    // The service worker is built by esbuild, which by default takes its target
    // from our `browserslist` — and that now names iOS/Safari 12 so the APP
    // bundle gets downlevelled for old iPhones. esbuild cannot downlevel
    // destructuring to safari12 ("not supported yet") and fails the whole build.
    //
    // Pinning the SW alone is correct rather than a workaround: a service worker
    // only ever runs in a browser that HAS service workers, and this one is
    // written against the Cache/Fetch APIs, so nothing about it needs a target
    // older than es2020. The old-iPhone target belongs on the app bundle, which
    // is the code that has to parse on the phone's main thread.
    esbuildOptions: { target: 'es2020' },
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
