import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const origin = 'http://127.0.0.1:4189';
const evidence = process.env.RUNNER_TEMP
  ? path.join(process.env.RUNNER_TEMP, 'viewer-static-evidence')
  : path.join(process.cwd(), '.output', 'static-evidence');
await mkdir(evidence, { recursive: true });
const server = spawn('python3', ['-m', 'http.server', '4189', '--bind', '127.0.0.1',
  '--directory', '.output/public'], { stdio: 'ignore' });
const source = '/* [Dimensions] */\nwidth = 12; // [4:1:30]\ncube([width,width,5]);\n';
const libraryTree = {
  truncated: false,
  tree: ['Box/Box.scad', 'Box/Lid.scad'].map((name, index) => ({
    path: name, type: 'blob', mode: '100644', size: Buffer.byteLength(source),
    sha: (index ? 'c' : 'b').repeat(40),
  })),
};
let browser;
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(origin)).ok) { ready = true; break; } }
    catch { /* server may still be starting */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error('Static Viewer is not listening');
  browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--disable-dev-shm-usage', '--enable-unsafe-swiftshader'] });
  for (const device of [{ name: 'desktop', width: 1280, height: 800 },
                       { name: 'mobile', width: 390, height: 844 }]) {
    const context = await browser.newContext({
      viewport: { width: device.width, height: device.height }, serviceWorkers: 'block',
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://api.github.com/repos/Noty-design/Parametric-designs/git/trees/**',
      async route => route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify(libraryTree), headers: { 'access-control-allow-origin': '*' } }));
    await page.route('https://raw.githubusercontent.com/Noty-design/Parametric-designs/**',
      async route => route.fulfill({ status: 200, contentType: 'text/plain',
        body: source, headers: { 'access-control-allow-origin': '*' } }));
    try {
      await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForFunction(() =>
        document.documentElement.dataset.brepiaClientReady === 'true',
        null, { timeout: 45000 });
      const chooser = page.getByRole('button', { name: 'Choose model from Box folder' });
      await chooser.waitFor({ state: 'visible', timeout: 30000 });
      await chooser.focus();
      await page.keyboard.press('Enter');

      const menu = page.getByRole('menu');
      try {
        await menu.waitFor({ state: 'visible', timeout: 15000 });
      } catch (cause) {
        await page.screenshot({ path: path.join(evidence, 'folder-dropdown-' +
          device.name + '-menu-failure.png'), fullPage: false });
        const diagnostics = await page.evaluate(() => ({
          menus: [...document.querySelectorAll('[role="menu"]')].map(item => ({
            label: item.getAttribute('aria-label'), text: item.textContent?.slice(0,150),
          })),
          chooser: document.querySelector('button[aria-label="Choose model from Box folder"]')
            ?.getAttribute('aria-expanded'),
        }));
        throw new Error('Dropdown failed to open: ' + JSON.stringify(diagnostics), { cause });
      }
      const options = menu.getByRole('menuitem');
      if (await options.count() !== 2) {
        throw new Error('Expected both Box.scad and Lid.scad in the folder dropdown');
      }
      const bounds = await menu.boundingBox();
      if (!bounds || bounds.width < 140 ||
          bounds.x < -1 || bounds.x + bounds.width > device.width + 1 ||
          bounds.y < -1 || bounds.y + bounds.height > device.height + 1) {
        throw new Error('Dropdown does not fit ' + device.name + ': ' + JSON.stringify(bounds));
      }
      await page.screenshot({ path: path.join(evidence, 'folder-dropdown-' +
        device.name + '-open.png'), fullPage: false });

      await page.keyboard.press('Escape');
      await menu.waitFor({ state: 'hidden', timeout: 10000 });
      await chooser.click();
      await menu.getByRole('menuitem', { name: 'Open Box/Lid.scad' }).click();

      await page.getByText('Source and parameters', { exact: true }).first()
        .waitFor({ timeout: 60000 });
      await page.getByText(/\b12 triangles\b/).first()
        .waitFor({ timeout: 120000 });
      const canvas = page.locator('section[aria-label="3D model preview"] canvas').first();
      await canvas.waitFor({ state: 'visible', timeout: 90000 });
      await page.waitForFunction(() => {
        const element = document.querySelector('section[aria-label="3D model preview"] canvas');
        const rect = element?.getBoundingClientRect();
        return rect && rect.width >= 80 && rect.height >= 80;
      }, null, { timeout: 90000 });
      await page.screenshot({ path: path.join(evidence, 'folder-dropdown-' +
        device.name + '-selected.png'), fullPage: true });
      if (errors.length) throw new Error(device.name + ' JS errors: ' + errors.join('; '));
      console.log('PASS', device.name, 'keyboard, Escape, mobile bounds, selection, 3D rendering');
    } finally {
      await context.close();
    }
  }
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
