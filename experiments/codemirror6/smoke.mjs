import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from '@playwright/test';

const url = 'http://127.0.0.1:4175/?smoke=1';
const evidenceDir = path.resolve('smoke-evidence');
await mkdir(evidenceDir, { recursive: true });
const results = [];
let serverLog = '';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4175', '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', data => { serverLog += data.toString().slice(-1000); });
server.stderr.on('data', data => { serverLog += data.toString().slice(-1000); });

let browser;
let failed = false;

async function testDevice(device) {
  const context = await browser.newContext({
    viewport: { width: device.width, height: device.height },
    isMobile: device.name === 'mobile',
    hasTouch: device.name === 'mobile',
    deviceScaleFactor: device.name === 'mobile' ? 2 : 1,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.setDefaultNavigationTimeout(45000);
  console.log('Starting ' + device.name + ' browser checks');
  const errors = [];
  page.on('pageerror', err => errors.push(String(err.message)));
  const check = async (name, fn) => {
    console.log('[' + device.name + '] RUN ' + name);
    await fn();
    console.log('[' + device.name + '] PASS ' + name);
    results.push({ device: device.name, test: name, status: 'PASS' });
  };
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    await page.locator('.cm-editor').waitFor({ timeout: 10000 });
    const read = () => page.evaluate(() => window.__brepiaSmokeView?.state.doc.toString());
    const original = await read();
    assert.ok(original.includes('demo_shape(width, height);'), 'initial OpenSCAD fixture not loaded');

    await check('editor loaded with line numbers', async () => {
      assert.ok(await page.locator('.cm-gutters .cm-lineNumbers').count(), 'no line number gutter');
      assert.ok(await page.locator('[contenteditable=true].cm-content').count(), 'missing editable surface');
    });

    await check('cube / discard / dirty state', async () => {
      await page.getByRole('button', { name: 'Cube' }).click();
      assert.ok((await read()).includes('cube([10, 10, 10], center = true);'));
      assert.equal(await page.locator('#status').getAttribute('data-dirty'), 'true');
      await page.getByRole('button', { name: 'Discard' }).click();
      assert.equal(await read(), original);
      assert.equal(await page.locator('#status').getAttribute('data-dirty'), 'false');
    });

    await check('translate wraps selected code', async () => {
      await page.evaluate(() => {
        const view = window.__brepiaSmokeView;
        const text = 'demo_shape(width, height);';
        const pos = view.state.doc.toString().indexOf(text);
        view.dispatch({ selection: { anchor: pos, head: pos + text.length } });
      });
      await page.getByRole('button', { name: 'Translate' }).click();
      assert.ok((await read()).includes('translate([10, 0, 0]) {\n    demo_shape(width, height);\n}'));
      await page.getByRole('button', { name: 'Discard' }).click();
    });

    await check('multiple file drafts and Save', async () => {
      await page.getByRole('button', { name: 'Cube' }).click();
      const draft = await read();
      await page.locator('#file').selectOption('lib/shape.scad');
      assert.ok((await read()).includes('module demo_shape'));
      await page.locator('#file').selectOption('main.scad');
      assert.equal(await read(), draft, 'draft lost during file switch');
      await page.getByRole('button', { name: 'Save' }).click();
      assert.equal(await page.locator('#status').getAttribute('data-dirty'), 'false');
      await page.locator('#file').selectOption('lib/shape.scad');
      await page.locator('#file').selectOption('main.scad');
      assert.equal(await read(), draft, 'saved in-memory content lost during file switch');
    });

    await check('select all occurrences and edit simultaneously', async () => {
      await page.evaluate(() => {
        const view = window.__brepiaSmokeView;
        const code = 'width = 1;\nwidth = 2;\n';
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: code },
          selection: { anchor: 0, head: 5 },
        });
      });
      await page.getByRole('button', { name: 'Select all matches' }).click();
      const ranges = await page.evaluate(() => window.__brepiaSmokeView.state.selection.ranges.length);
      assert.equal(ranges, 2, 'select all did not create two selection ranges');
      await page.keyboard.type('height');
      assert.equal(await read(), 'height = 1;\nheight = 2;\n');
    });

    await check('OpenSCAD completion menu', async () => {
      await page.evaluate(() => {
        const view = window.__brepiaSmokeView;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: 'cub' },
          selection: { anchor: 3 },
        });
      });
      await page.getByRole('button', { name: 'Complete' }).click();
      await page.locator('.cm-tooltip-autocomplete').waitFor({ timeout: 10000 });
      const options = await page.locator('.cm-tooltip-autocomplete').innerText();
      assert.ok(options.includes('cube'), 'cube completion missing');
      console.log('[' + device.name + '] Completion active element:', await page.evaluate(() => ({
        tag: document.activeElement?.tagName,
        className: document.activeElement?.className,
      })));
      await page.keyboard.press('Enter');
      const applied = await read();
      console.log('[' + device.name + '] Completion result:', JSON.stringify(applied));
      assert.ok(applied.includes('cube([10, 10, 10], center = true);'), 'completion insertion mismatch: ' + JSON.stringify(applied));
    });

    await check('no page-width overflow and no uncaught errors', async () => {
      const sizes = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        width: window.innerWidth,
        editorHeight: document.querySelector('.cm-editor').getBoundingClientRect().height,
      }));
      assert.ok(sizes.scrollWidth <= sizes.width + 2, 'horizontal page overflow: ' + JSON.stringify(sizes));
      assert.ok(sizes.editorHeight > device.height * 0.35, 'editor height too small');
      assert.deepEqual(errors, [], 'browser uncaught errors');
    });

    // Browser touch emulation is not a physical Android/iOS IME test.
    results.push({ device: device.name, test: 'physical virtual keyboard / composition', status: 'NOT_RUN' });
  } catch (error) {
    failed = true;
    console.error('[' + device.name + '] FAIL', error);
    results.push({ device: device.name, test: 'failed step', status: 'FAIL', message: String(error?.stack || error).slice(0, 1800) });
  } finally {
    await page.screenshot({ path: path.join(evidenceDir, device.name + '.png'), fullPage: true }).catch(() => {});
    await context.close();
  }
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) break;
    try {
      const response = await fetch(url);
      if (response.ok) { ready = true; break; }
    } catch {}
    await sleep(300);
  }
  assert.ok(ready, 'Vite preview did not start: ' + serverLog);
  browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  await testDevice({ name: 'desktop', width: 1440, height: 900 });
  await testDevice({ name: 'mobile', width: 390, height: 844 });
} catch (error) {
  failed = true;
  results.push({ device: 'runner', test: 'startup', status: 'FAIL', message: String(error?.stack || error).slice(0, 1800) });
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
  const report = {
    testedAt: new Date().toISOString(),
    commit: process.env.GITHUB_SHA ?? 'unavailable',
    url,
    results,
    note: 'The mobile profile uses Chromium viewport/touch emulation, not a physical IME.',
  };
  await writeFile(path.join(evidenceDir, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('CODEMIRROR_PROTOTYPE_SMOKE=' + JSON.stringify(report));
}
if (failed) process.exitCode = 1;
