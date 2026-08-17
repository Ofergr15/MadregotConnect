import { writeFileSync } from 'fs';
import { renderGarminClipboardPng, CLIPBOARD_VERSION } from '../src/lib/run-chat/garmin-clipboard';
import { TEST_PLANNED_WORKOUT } from '../src/lib/run-chat/mock-workout';

const buf = await renderGarminClipboardPng(TEST_PLANNED_WORKOUT);
writeFileSync('examples/clipboard_images/_generated-preview.png', buf);
console.log(`wrote clipboard ${CLIPBOARD_VERSION}: ${buf.length} bytes`);
