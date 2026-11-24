import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const origin = 'http://127.0.0.1:4181';
const evidence = process.env.RUNNER_TEMP
  ? path.join(process.env.RUNNER_TEMP, 'viewer-static-evidence')
  : path.join(process.cwd(), '.output', 'static-evidence');
await mkdir(evidence, { recursive: true });
const server = spawn('python3', ['-m', 'http.server', '4181', '--bind', '127.0.0.1', '--directory', '.output/public'], { stdio: 'ignore' });
let browser;
const sha = 'a'.repeat(40);
const scad = '/* [Dimensions] */\nwidth = 12; // [4:1:30]\ncube([width, width, 5]);\n';
const fileLength = Buffer.byteLength(scad);
const presets = JSON.stringify({
  fileFormatVersion: "1",
  parameterSets: {
    Wide: { width: 24 },
    Narrow: { width: 8 },
  },
});
const tree = {
  truncated: false,
  tree: [
    { path: 'knob_factory/knob-factory.scad', type: 'blob', mode: '100644', sha: 'b'.repeat(40), size: fileLength },
    { path: 'knob_factory/knob-factory.json', type: 'blob', mode: '100644', sha: 'e'.repeat(40), size: Buffer.byteLength(presets) },
    { path: 'knob_factory/README.png', type: 'blob', mode: '100644', sha: 'c'.repeat(40), size: 100 },
    { path: 'other/example.scad', type: 'blob', mode: '100644', sha: 'd'.repeat(40), size: fileLength },
  ],
};

try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(origin)).ok) { ready = true; break; }
    } catch { /* waiting for server */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error('Static viewer HTTP server did not start.');
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-dev-shm-usage', '--enable-unsafe-swiftshader'] });

  for (const device of [{ name: 'desktop', width: 1280, height: 800 }, { name: 'mobile', width: 390, height: 844 }]) {
    for (const scenario of ['blob', 'repository', 'linked-folder']) {
      const context = await browser.newContext({ viewport: { width: device.width, height: device.height }, serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('https://api.github.com/repos/tanius/openscad-models**', async route => {
        const url = route.request().url();
        let body;
        if (url.includes('/branches?')) body = [{ name: 'master', commit: { sha } }];
        else if (url.includes('/git/trees/')) body = tree;
        else body = { default_branch: 'master' };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } });
      });
      await page.route('https://raw.githubusercontent.com/tanius/openscad-models/**', async route => {
        const json = route.request().url().endsWith('/knob_factory/knob-factory.json');
        await route.fulfill({ status: 200, contentType: json ? 'application/json' : 'text/plain',
          body: json ? presets : scad, headers: { 'access-control-allow-origin': '*' } });
      });
      if (scenario === 'linked-folder') {
        const url = 'https://github.com/tanius/openscad-models/tree/master/knob_factory';
        await page.goto(origin + '/?model=' + encodeURIComponent(url),
          { waitUntil: 'domcontentloaded', timeout: 45000 });
      } else {
        await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.getByText('Model gallery', { exact: true }).first().waitFor({ timeout: 30000 });
        await page.getByRole('button', { name: 'Import from URL' }).click();
        const url = scenario === 'blob'
          ? 'https://github.com/tanius/openscad-models/blob/master/knob_factory%2Fknob-factory.scad'
          : 'https://github.com/tanius/openscad-models/tree/master';
        await page.getByRole('textbox', { name: 'OpenSCAD file or GitHub project URL' }).fill(url);
        await page.getByRole('button', { name: 'Continue' }).click();
        await page.getByRole('region', { name: 'Choose GitHub project' }).waitFor({ timeout: 25000 });
        if (scenario === 'repository') {
          await page.getByLabel('Project folder').selectOption('knob_factory');
        }
        await page.getByRole('button', { name: 'Import selected project' }).click();
      }
      await page.getByText('Source and parameters', { exact: true }).first().waitFor({ timeout: 45000 });
      await page.getByRole('region', { name: '3D model preview' }).waitFor({ timeout: 30000 });
      // Do not treat a successful download as rendered geometry: OpenSCAD must
      // finish compiling the imported fixture before the test can pass.
      await page.getByText(/\b12 triangles\b/).first().waitFor({ timeout: 120000 });
      // The folder JSON must be loaded automatically for both URL and manual imports.
      const saved = page.getByTestId('saved-variants-panel');
      await saved.waitFor({ state: 'visible', timeout: 30000 });
      const selector = saved.getByRole('combobox', { name: 'Choose saved variant' });
      await selector.locator('option', { hasText: 'Wide' }).waitFor({ state: 'attached', timeout: 10000 });
      await selector.locator('option', { hasText: 'Narrow' }).waitFor({ state: 'attached', timeout: 10000 });
      await selector.selectOption('Wide');
      await page.waitForFunction(() =>
        document.querySelector('[data-testid="saved-variants-panel"] select[aria-label="Choose saved variant"]')?.value === 'Wide',
        null, { timeout: 30000 });
      // Thumbnail creation can add its own canvas before the actual 3D viewer.
      // Wait for the scene canvas in its preview region to acquire usable size.
      const canvas = page.locator('section[aria-label="3D model preview"] canvas').first();
      await canvas.waitFor({ state: 'visible', timeout: 90000 });
      await page.waitForFunction(() => {
        const target = document.querySelector('section[aria-label="3D model preview"] canvas');
        if (!target) return false;
        const bounds = target.getBoundingClientRect();
        return bounds.width >= 80 && bounds.height >= 80;
      }, null, { timeout: 90000 });
      await page.screenshot({ path: path.join(evidence, `github-import-${scenario}-${device.name}.png`), fullPage: true });
      if (errors.length) throw new Error(`${device.name} ${scenario} JS errors: ${errors.join('; ')}`);
      await context.close();
    }
  }
  console.log('PASS: GitHub blob, folder and deep links auto-load sibling Customizer JSON presets on desktop/mobile.');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
