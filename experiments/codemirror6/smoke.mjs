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
    isMobile: device.name !== 'desktop',
    hasTouch: device.name !== 'desktop',
    deviceScaleFactor: device.name !== 'desktop' ? 2 : 1,
  });
  const page = await context.newPage();
  if (device.name !== 'desktop') {
    const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
    assert.ok(coarse, 'mobile profile must emulate a coarse pointer');
  }
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

    await check('compact icon toolbar with accessible names', async () => {
      const names = ['Find / replace', 'Insert OpenSCAD code', 'More editor tools', 'Save'];
      if (device.width > 375) names.push('Selection tools');
      for (const name of names) {
        const control = page.getByRole('button', { name });
        assert.equal(await control.count(), 1, 'missing toolbar control: ' + name);
        const bounds = await control.boundingBox();
        const size = device.name === 'desktop' ? 36 : 42;
        assert.ok(bounds && bounds.height >= size && bounds.width >= size, 'toolbar control too small: ' + name);
      }
      const chrome = await page.evaluate(() => {
        const bar = document.querySelector('.toolbar').getBoundingClientRect();
        const file = document.querySelector('#file').getBoundingClientRect();
        const controls = [...document.querySelectorAll('.toolbar > button, .toolbar > details:not([hidden]) > summary')]
          .filter(el => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width);
        return { height: bar.height, width: bar.width, fileTop: file.y, toolbarTop: bar.y,
          controlYs: controls.map(el => el.getBoundingClientRect().y), visualIcon: document.querySelector('.toolbar .icon').getBoundingClientRect().width,
          workspaceWidth: document.querySelector('.workspace').getBoundingClientRect().width };
      });
      assert.ok(chrome.height <= 50, 'toolbar occupies too much vertical space: ' + JSON.stringify(chrome));
      assert.ok(chrome.visualIcon <= 20, 'visual icon should remain compact');
      assert.ok(chrome.controlYs.every(y => Math.abs(y - chrome.toolbarTop) < 3), 'toolbar controls are not on a single row');
      if (device.width <= 375) {
        assert.equal(await page.getByRole('button', { name: 'Save' }).count(), 1, 'icon-only Save must retain its accessible name');
        assert.equal(await page.locator('.save-action span').isVisible(), false, 'narrow Save should use only the icon');
      }
      assert.equal(await page.locator('header').count(), 0, 'large introductory header should not be visible');
      assert.equal(await page.locator('.notice').count(), 0, 'prototype notice should not consume permanent workspace');
      assert.equal(await page.getByRole('button', { name: 'Cube' }).isVisible(), false, 'snippet unexpectedly visible with menu closed');
    });

    await check('category menu opens, closes, and inserts primitives', async () => {
      const before = await page.locator('.cm-editor').boundingBox();
      await page.getByRole('button', { name: 'Insert OpenSCAD code' }).click();
      const after = await page.locator('.cm-editor').boundingBox();
      assert.ok(before && after && Math.abs(before.height - after.height) < 2, 'menu resize unexpectedly shrank the editor');
      await page.screenshot({ path: path.join(evidenceDir, device.name + '-insert-menu.png'), fullPage: true });
      assert.ok(await page.getByRole('button', { name: 'Cube' }).isVisible());
      assert.ok(await page.getByRole('button', { name: 'Sphere' }).isVisible());
      await page.getByRole('button', { name: 'Sphere' }).click();
      assert.ok((await read()).includes('sphere(r = 10);'), 'sphere snippet not inserted');
      assert.equal(await page.locator('#insert-menu').evaluate(el => el.open), false, 'snippet menu failed to close');
      await page.getByRole('button', { name: 'Insert OpenSCAD code' }).click();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#insert-menu').evaluate(el => el.open), false, 'Escape did not close menu');
      await page.getByRole('button', { name: 'More editor tools' }).click();
      assert.ok(await page.getByRole('button', { name: 'Discard' }).isVisible(), 'discard not available in More');
      await page.getByRole('button', { name: 'Discard' }).click();
      assert.equal(await read(), original);
    });

    await check('cube / discard / dirty state', async () => {
      await page.getByRole('button', { name: 'Insert OpenSCAD code' }).click();
      await page.getByRole('button', { name: 'Cube' }).click();
      assert.ok((await read()).includes('cube([10, 10, 10], center = true);'));
      assert.equal(await page.locator('#status').getAttribute('data-dirty'), 'true');
      await page.getByRole('button', { name: 'More editor tools' }).click();
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
      await page.getByRole('button', { name: 'Insert OpenSCAD code' }).click();
      await page.getByRole('button', { name: 'Translate' }).click();
      assert.ok((await read()).includes('translate([10, 0, 0]) {\n    demo_shape(width, height);\n}'));
      await page.getByRole('button', { name: 'More editor tools' }).click();
      await page.getByRole('button', { name: 'Discard' }).click();
    });

    await check('multiple file drafts and Save', async () => {
      await page.getByRole('button', { name: 'Insert OpenSCAD code' }).click();
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
      if (device.width > 375) {
        await page.getByRole('button', { name: 'Selection tools' }).click();
      } else {
        await page.getByRole('button', { name: 'More editor tools' }).click();
      }
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
      await page.getByRole('button', { name: 'More editor tools' }).click();
      await page.getByRole('button', { name: 'Complete' }).click();
      await page.locator('.cm-tooltip-autocomplete').waitFor({ timeout: 10000 });
      const options = await page.locator('.cm-tooltip-autocomplete').innerText();
      assert.ok(options.includes('cube'), 'cube completion missing');
      // CodeMirror deliberately ignores acceptance during the first 75ms of
      // an opened popup to avoid accidental Enter from earlier key presses.
      await page.waitForTimeout(140);
      await page.keyboard.press('Enter');
      const applied = await read();
      assert.ok(applied.includes('cube([10, 10, 10], center = true);'), 'completion insertion mismatch: ' + JSON.stringify(applied));
    });

    await check('ordinary Enter still inserts a newline', async () => {
      await page.evaluate(() => {
        const view = window.__brepiaSmokeView;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: 'cube(10);' },
          selection: { anchor: 9 },
        });
      });
      await page.locator('.cm-content').focus();
      await page.keyboard.press('Enter');
      assert.ok((await read()).includes(String.fromCharCode(10)), 'normal Enter did not insert a newline');
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
  await testDevice({ name: 'narrow-mobile', width: 320, height: 700 });
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
