import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';

const target = pathToFileURL(resolve(process.argv[2] ?? 'dist/index.html')).href;
const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--allow-file-access-from-files']
});

try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    await page.setViewport({ width: 1400, height: 900 });
    await page.goto(target, { waitUntil: 'load' });
    await page.waitForSelector('#canvas-content .layer-group > *', { timeout: 10_000 });

    const drawn = await page.evaluate(() =>
        document.querySelectorAll('#canvas-content .layer-group > *').length
    );

    if (errors.length > 0) {
        throw new Error(`Standalone build raised page errors:\n${errors.join('\n')}`);
    }
    if (drawn === 0) {
        throw new Error('Standalone build rendered an empty canvas.');
    }

    console.log(`Standalone smoke test passed (${drawn} drawn elements).`);
} finally {
    await browser.close();
}
