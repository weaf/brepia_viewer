import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import path from 'node:path';

const root = path.resolve('.output/public');
const port = 4184;
const origin = 'http://127.0.0.1:' + port;
const evidence = process.env.RUNNER_TEMP
  ? path.join(process.env.RUNNER_TEMP, 'viewer-fast-preview-evidence')
  : path.resolve('.output/fast-preview-evidence');
await mkdir(evidence, { recursive: true });
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', root], {
  stdio: 'ignore',
});
let browser;
const reports = [];
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(origin)).ok) { ready = true; break; }
    } catch {
      // The isolated HTTP server may still be starting.
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('Static test server did not become available');
  browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--disable-dev-shm-usage', '--enable-unsafe-swiftshader'] });

  for (const device of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport: { width: device.width, height: device.height },
      acceptDownloads: true, serviceWorkers: 'block',
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await page.getByText('Model gallery', { exact: true }).first().waitFor();
      await page.locator('input[type="file"][accept=".scad,.scad.txt"]').setInputFiles({
        name: 'fast-preview-color-test.scad',
        mimeType: 'text/plain',
        buffer: Buffer.from('/* [Shape] */\nsize = 10; // [5:1:20]\ncolor("red") cube([size,size,size]);\n'),
      });
      await page.getByText('Source and parameters', { exact: true }).first().waitFor({ timeout: 30000 });
      await page.getByTestId('off-component-inspector').waitFor({ timeout: 60000 });
      await page.screenshot({ path: path.join(evidence, device.name + '-default-colors.png') });
      const experimental = page.getByRole('button', { name: 'Experimental menu' });
      await experimental.click();
      const master = page.getByRole('menuitemcheckbox', { name: 'Enable Experimental mode' });
      if ((await master.getAttribute('data-state')) !== 'unchecked') throw new Error('Experimental unexpectedly enabled');
      await master.click();
      await experimental.click();
      const fastToggle = page.getByRole('menuitemcheckbox', { name: 'Enable fast STL-only preview' });
      await fastToggle.waitFor();
      if ((await fastToggle.getAttribute('data-state')) !== 'unchecked') throw new Error('Fast preview unexpectedly enabled');
      await fastToggle.click();
      await page.getByTestId('fast-preview-color-notice').waitFor({ timeout: 45000 });
      await page.waitForFunction(() => {
        const diagnostics = document.querySelector('[data-testid="experimental-preview-diagnostics"]');
        const field = [...(diagnostics?.querySelectorAll('dt') ?? [])]
          .find(element => element.textContent?.trim() === 'OFF size');
        return field?.nextElementSibling?.textContent?.trim() === 'Unavailable';
      }, null, { timeout: 45000 });
      if (await page.getByTestId('off-component-inspector').count() !== 0) {
        throw new Error('Stale OFF color inspector remained in fast mode');
      }
      const previewPane = page.getByRole('region', { name: '3D model preview' });
      const geometryCanvas = previewPane.locator('canvas');
      await geometryCanvas.waitFor({ state: 'visible', timeout: 30000 });
      await page.screenshot({ path: path.join(evidence, device.name + '-fast-stl.png') });

      // The export must still obtain full OFF colors on demand, rather
      // than silently turning a colored model into a monochrome 3MF.
      await page.getByRole('button', { name: 'Export model' }).click();
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 50000 }),
        page.getByRole('menuitem', { name: 'Orca Color: Single Object' }).click(),
      ]);
      const file = path.join(evidence, device.name + '-fast-preview.orca.3mf');
      await download.saveAs(file);
      const zip = unzipSync(new Uint8Array(await readFile(file)));
      const xml = new TextDecoder().decode(zip['3D/3dmodel.model']);
      if (!xml.includes('<triangle ') || !xml.includes('unit="millimeter"')) {
        throw new Error('Invalid color 3MF after fast preview');
      }

      await experimental.click();
      const enabledFast = page.getByRole('menuitemcheckbox', { name: 'Enable fast STL-only preview' });
      if (await enabledFast.getAttribute('data-state') !== 'checked') throw new Error('Fast state did not persist in session');
      await enabledFast.click();
      await page.getByTestId('off-component-inspector').waitFor({ timeout: 50000 });
      if (await page.getByTestId('fast-preview-color-notice').count()) {
        throw new Error('Fast-preview warning remained when disabled');
      }
      await page.screenshot({ path: path.join(evidence, device.name + '-restored-colors.png') });
      if (errors.length) throw new Error('Browser errors: ' + errors.join('; '));
      reports.push({ device: device.name, status: 'PASS', canvas: await geometryCanvas.count(),
        orca3mfBytes: (await readFile(file)).byteLength });
      console.log('FAST_PREVIEW_PASS ' + JSON.stringify(reports.at(-1)));
    } finally {
      await context.close();
    }
  }
} catch (error) {
  console.error('FAST_PREVIEW_FAIL', error?.stack ?? String(error));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
console.log('FAST_PREVIEW_RESULTS=' + JSON.stringify(reports));
