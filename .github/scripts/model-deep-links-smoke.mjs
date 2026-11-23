import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const origin = 'http://127.0.0.1:4187';
const evidence = process.env.RUNNER_TEMP
  ? path.join(process.env.RUNNER_TEMP, 'viewer-static-evidence')
  : path.join(process.cwd(), '.output', 'static-evidence');
await mkdir(evidence, { recursive: true });
const server = spawn('python3', ['-m', 'http.server', '4187', '--bind', '127.0.0.1', '--directory', '.output/public'], { stdio: 'ignore' });
let browser;
const source = '/* [Dimensions] */\nwidth = 12; // [4:1:30]\ncube([width,width,5]);\n';
const blobSha = 'a'.repeat(40);
const fileSha = 'b'.repeat(40);
const ghTree = {
  truncated: false,
  tree: [
    { path: 'knob_factory/knob-factory.scad', type: 'blob', mode: '100644', sha: fileSha, size: Buffer.byteLength(source) },
    { path: 'other/example.scad', type: 'blob', mode: '100644', sha: fileSha, size: Buffer.byteLength(source) },
  ],
};
const libraryTree = {
  truncated: false,
  tree: [{ path: 'Box/Box.scad', type: 'blob', mode: '100644', sha: fileSha, size: Buffer.byteLength(source) }],
};
const fulfilled = { 'access-control-allow-origin': '*' };

try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(origin)).ok) { ready = true; break; }
    } catch { /* wait for test HTTP server */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error('Static model-link test HTTP server unavailable.');
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-dev-shm-usage', '--enable-unsafe-swiftshader'] });

  for (const device of [{ name: 'desktop', width: 1280, height: 800 }, { name: 'mobile', width: 390, height: 844 }]) {
    for (const scenario of ['direct', 'github-file', 'github-picker', 'library', 'filter']) {
      const context = await browser.newContext({ viewport: { width: device.width, height: device.height }, serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      if (scenario === 'library') {
        await page.addInitScript(() => {
          // Only replace the clipboard transport, not the Share handler or URL builder.
          Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: async (value) => { window.__copiedViewerModelLink = value; } },
          });
        });
      }
      await page.route('https://models.example.test/test.scad', async route => {
        await route.fulfill({ status: 200, contentType: 'text/plain', body: source, headers: fulfilled });
      });
      await page.route('https://api.github.com/repos/tanius/openscad-models**', async route => {
        const url = route.request().url();
        const body = url.includes('/branches?') ? [{ name: 'master', commit: { sha: blobSha } }]
          : url.includes('/git/trees/') ? ghTree : { default_branch: 'master' };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body), headers: fulfilled });
      });
      await page.route('https://raw.githubusercontent.com/tanius/openscad-models/**', async route => {
        await route.fulfill({ status: 200, contentType: 'text/plain', body: source, headers: fulfilled });
      });
      await page.route('https://api.github.com/repos/Noty-design/Parametric-designs/git/trees/**', async route => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(libraryTree), headers: fulfilled });
      });
      await page.route('https://raw.githubusercontent.com/Noty-design/Parametric-designs/**', async route => {
        await route.fulfill({ status: 200, contentType: 'text/plain', body: source, headers: fulfilled });
      });

      let target = origin + '/';
      if (scenario === 'direct') target += '?model=' + encodeURIComponent('https://models.example.test/test.scad');
      if (scenario === 'github-file') target += '?model=' + encodeURIComponent('https://github.com/tanius/openscad-models/blob/master/knob_factory%2Fknob-factory.scad');
      if (scenario === 'github-picker') target += '?model=' + encodeURIComponent('https://github.com/tanius/openscad-models/tree/master');
      if (scenario === 'library') target += '?library=parametric-designs&file=Box%2FBox.scad';
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45000 });
      // The static build serves prerendered HTML. Controls are inert until React hydrates.
      await page.waitForFunction(() => document.documentElement.dataset.brepiaClientReady === 'true', null, { timeout: 45000 });

      if (scenario === 'github-picker') {
        await page.getByRole('region', { name: 'Choose GitHub project' }).waitFor({ timeout: 30000 });
        await page.getByRole('button', { name: 'Import selected project' }).waitFor({ timeout: 30000 });
      } else if (scenario === 'filter') {
        await page.getByText('Model gallery', { exact: true }).first().waitFor({ timeout: 45000 });
        await page.getByRole('combobox', { name: 'Filter models by library' }).selectOption('parametric-designs');
        const filter = page.getByRole('combobox', { name: 'Filter models by library' });
        await page.waitForFunction(() =>
          document.querySelector('select[aria-label="Filter models by library"]')?.value === 'parametric-designs',
          null, { timeout: 10000 });
        await page.waitForFunction(() =>
          document.querySelectorAll('[data-gallery-model-id]').length > 0,
          null, { timeout: 30000 });
        await filter.selectOption('uploads');
        await page.waitForFunction(() =>
          document.querySelectorAll('[data-gallery-model-id]').length === 0,
          null, { timeout: 10000 });
        await filter.selectOption('all');
        await page.waitForFunction(() =>
          document.querySelectorAll('[data-gallery-model-id]').length > 0,
          null, { timeout: 10000 });
        await filter.selectOption('parametric-designs');
        if (await filter.inputValue() !== 'parametric-designs') {
          throw new Error('Library filter did not preserve the requested selection after hydration.');
        }
      } else {
        await page.getByText('Source and parameters', { exact: true }).first().waitFor({ timeout: 60000 });
        await page.getByRole('region', { name: '3D model preview' }).waitFor({ timeout: 45000 });
        await page.getByText(/\b12 triangles\b/).first().waitFor({ timeout: 120000 });
        // Successful OpenSCAD compilation does not imply Three.js has mounted or painted.
        const canvas = page.locator('section[aria-label="3D model preview"] canvas').first();
        await canvas.waitFor({ state: 'visible', timeout: 90000 });
        await page.waitForFunction(() => {
          const element = document.querySelector('section[aria-label="3D model preview"] canvas');
          const rect = element?.getBoundingClientRect();
          return rect && rect.width >= 80 && rect.height >= 80;
        }, null, { timeout: 90000 });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        if (scenario === 'library') {
          const share = page.getByRole('button', { name: 'Share' });
          if (!(await share.isVisible())) throw new Error('Library model share control missing.');
          const buttonBounds = await share.boundingBox();
          if (!buttonBounds || buttonBounds.x < 0 || buttonBounds.x + buttonBounds.width > device.width) {
            throw new Error(device.name + ' Share action clipped outside the viewport: ' + JSON.stringify(buttonBounds));
          }
          await share.click();
          await page.waitForFunction(() =>
            window.__copiedViewerModelLink?.includes('?library=parametric-designs&file=Box%2FBox.scad'),
            null, { timeout: 10000 });
        }
      }
      await page.screenshot({ path: path.join(evidence, 'model-link-' + device.name + '-' + scenario + '.png'), fullPage: true });
      if (errors.length) throw new Error(device.name + ' ' + scenario + ' JS errors: ' + errors.join('; '));
      await context.close();
    }
  }
  console.log('PASS: shareable SCAD/GitHub links, ambiguous project picker, curated library deep links and library filter, desktop and mobile.');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
