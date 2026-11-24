import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const origin = 'http://127.0.0.1:4195';
const evidence = process.env.RUNNER_TEMP
  ? path.join(process.env.RUNNER_TEMP, 'viewer-static-evidence')
  : path.join(process.cwd(), '.output', 'static-evidence');
await mkdir(evidence, { recursive: true });
const server = spawn('python3', ['-m', 'http.server', '4195', '--bind', '127.0.0.1',
  '--directory', '.output/public'], { stdio: 'ignore' });
const source = [
  '/* [Model choices] */',
  'part_selection = "both"; // [both:Both panels, top:Top-slotted panel A, bottom:Bottom-slotted panel B]',
  'snowflake_style = "crystal"; // [classic:Classic, crystal:Crystal, fern:Fern, dendrite:Dendrite, stellar:Stellar, needle:Needle, lace:Lace, plate:Plate, geometric:Geometric, coral:Coral, willow:Willow]',
  'numbered_design = 36; // [12:12 numbered designs, 36:36 numbered designs, 72:72 numbered designs]',
  'width = 12; // [4:1:30]',
  'cube([width,width,5]);',
].join('\n') + '\n';
let browser;
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(origin)).ok) { ready = true; break; } }
    catch { /* static server startup */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error('Static preview did not start.');
  browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--disable-dev-shm-usage', '--enable-unsafe-swiftshader'] });
  for (const device of [
    { name: 'desktop', width: 1280, height: 800, mobile: false },
    { name: 'mobile', width: 390, height: 844, mobile: true },
  ]) {
    const context = await browser.newContext({
      viewport: { width: device.width, height: device.height },
      isMobile: device.mobile, hasTouch: device.mobile, serviceWorkers: 'block',
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.route('https://models.example.test/enum-dropdown.scad', async route => {
        await route.fulfill({ status: 200, contentType: 'text/plain',
          body: source, headers: { 'access-control-allow-origin': '*' } });
      });
      await page.goto(origin + '/?model=' +
        encodeURIComponent('https://models.example.test/enum-dropdown.scad'),
        { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForFunction(() =>
        document.documentElement.dataset.brepiaClientReady === 'true',
        null, { timeout: 45000 });
      await page.getByText('Source and parameters', { exact: true }).first()
        .waitFor({ timeout: 60000 });
      const panel = page.getByTestId('model-parameters-scroll');
      const part = panel.getByRole('combobox', { name: 'Part Selection' });
      const style = panel.getByRole('combobox', { name: 'Snowflake Style' });
      const number = panel.getByRole('combobox', { name: 'Numbered Design' });
      for (const combo of [part, style, number]) {
        await combo.waitFor({ state: 'visible', timeout: 15000 });
        const layout = await combo.evaluate(el => {
          const rect = el.getBoundingClientRect();
          const styles = getComputedStyle(el);
          const parent = el.parentElement?.getBoundingClientRect();
          return { height: rect.height, width: rect.width, x: rect.x,
            nowrap: styles.whiteSpace === 'nowrap',
            fitsParent: parent && rect.width <= parent.width + 1 };
        });
        assert.equal(layout.nowrap, true, 'Enum control must not wrap option labels');
        assert.ok(layout.height <= 42, 'Enum control too tall: ' + JSON.stringify(layout));
        assert.ok(layout.fitsParent, 'Enum control overflows parameter column');
        assert.ok(layout.width > 100, 'Enum control is too narrow');
      }
      assert.deepEqual(await part.locator('option').allTextContents(),
        ['Both panels', 'Top-slotted panel A', 'Bottom-slotted panel B']);
      assert.equal(await style.locator('option').count(), 11);
      assert.deepEqual(await number.locator('option').allTextContents(),
        ['12 numbered designs', '36 numbered designs', '72 numbered designs']);
      assert.equal(await part.inputValue(), 'both');
      assert.equal(await style.inputValue(), 'crystal');
      assert.equal(await number.inputValue(), '36');
      assert.equal(await panel.getByRole('textbox', { name: 'Width', exact: true }).count(), 1,
        'Numeric slider/text input must remain unchanged');
      await page.screenshot({ path: path.join(evidence,
        device.name + '-enum-dropdown-before.png'), fullPage: true });

      // Native selects commit the source value, not its display label.
      await part.selectOption('bottom');
      await style.selectOption('willow');
      await number.selectOption('72');
      await page.waitForFunction(() => {
        const values = [...document.querySelectorAll('select')].reduce((all, el) => {
          all[el.getAttribute('aria-label')] = el.value;
          return all;
        }, {});
        return values['Part Selection'] === 'bottom' &&
          values['Snowflake Style'] === 'willow' &&
          values['Numbered Design'] === '72';
      }, null, { timeout: 30000 });

      await page.getByText(/\b12 triangles\b/).first().waitFor({ timeout: 120000 });
      await page.getByRole('button', { name: /Open enum-dropdown.scad/ }).click();
      const dialog = page.getByRole('dialog');
      const code = dialog.getByRole('textbox', { name: /OpenSCAD source for/i });
      await code.waitFor({ state: 'visible' });
      const updated = await code.inputValue();
      assert.match(updated, /part_selection\s*=\s*"bottom"/);
      assert.match(updated, /snowflake_style\s*=\s*"willow"/);
      assert.match(updated, /numbered_design\s*=\s*72/);
      await page.screenshot({ path: path.join(evidence,
        device.name + '-enum-dropdown-selected.png'), fullPage: true });
      if (errors.length) throw new Error(device.name + ' JS errors: ' + errors.join('; '));
      console.log('PASS', device.name, 'one-line enum dropdown, typed selection, source update');
    } finally {
      await context.close();
    }
  }
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
