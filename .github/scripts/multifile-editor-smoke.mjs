import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from '@playwright/test';

const origin = 'http://127.0.0.1:4181/';
const fixture = path.resolve('.github/fixtures/editor-twofiles');
const output = process.env.RUNNER_TEMP
  ? path.join(process.env.RUNNER_TEMP, 'viewer-static-evidence')
  : path.resolve('.output/static-evidence');
await mkdir(output, { recursive: true });
const server = spawn('python3', ['-m', 'http.server', '4181', '--bind', '127.0.0.1', '--directory', path.resolve('.output/public')], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverErrors = '';
server.stderr.on('data', value => { serverErrors += value.toString(); });

const results = [];
let browser;
let failed = false;

async function deviceCheck(device) {
  const context = await browser.newContext({
    viewport: { width: device.width, height: device.height },
    isMobile: device.mobile,
    hasTouch: device.mobile,
    deviceScaleFactor: device.mobile ? 2 : 1,
    acceptDownloads: true,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(45000);
  const errors = [];
  page.on('pageerror', error => errors.push(String(error.message).slice(0, 300)));
  let checkpoint = 'startup';
  const step = async (name, run) => {
    checkpoint = name;
    console.log('[' + device.name + '] RUN ' + name);
    await run();
    results.push({ device: device.name, name, status: 'PASS' });
    console.log('[' + device.name + '] PASS ' + name);
  };
  const read = locator => locator.innerText();

  try {
    await step('folder import preserving use dependency', async () => {
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await page.getByText('Model gallery', { exact: true }).waitFor({ timeout: 35000 });
      // Exercise the same button -> native file chooser path as a user.
      // Directly targeting the hidden, React-managed input has intermittently
      // stalled under Chromium mobile touch emulation even when it is attached.
      const uploadFolder = page.getByRole('button', { name: 'Upload folder', exact: true });
      await uploadFolder.waitFor({ state: 'visible' });
      const [folderChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 30000 }),
        uploadFolder.click(),
      ]);
      const folderChooserInput = await folderChooser.element();
      assert.equal(
        await folderChooserInput.evaluate(input => input.hasAttribute('webkitdirectory')),
        true,
        'Upload folder opened a chooser without directory-selection support',
      );
      await folderChooser.setFiles(fixture, { timeout: 45000 });
      await page.getByText('Source and parameters', { exact: true }).first().waitFor({ timeout: 40000 });
      assert.equal(await page.getByRole('button', { name: 'Open main.scad' }).count(), 1);
      assert.equal(await page.getByRole('button', { name: 'Open lib/geometry.scad' }).count(), 1);
      await page.getByText('Model uploaded', { exact: true }).waitFor({ state: 'visible' });
      await page.screenshot({ path: path.join(output, device.name + '-multifile-import.png'), fullPage: true });
    });

    await step('compact model header and independently scrolling parameters', async () => {
      const header=page.getByTestId('model-editor-header');
      const bounds=await header.boundingBox();
      assert.ok(bounds && bounds.height <= (device.mobile ? 122 : 68), 'model header takes more than two rows: '+JSON.stringify(bounds));
      const workspace=page.getByTestId('model-workspace');
      const scroller=page.getByTestId('model-parameters-scroll');
      const viewer=page.getByRole('region', {name:'3D model preview'});
      await page.getByRole('button',{name:'Lock viewer and parameters layout'}).click();
      assert.equal(await workspace.getAttribute('data-layout-locked'),'true');
      const previewBefore=await viewer.boundingBox();
      assert.ok(previewBefore && previewBefore.height>95);
      const dims=await scroller.evaluate(node=>{
        const max=node.scrollHeight-node.clientHeight;
        node.scrollTop=max;
        return {max,scrollTop:node.scrollTop};
      });
      assert.ok(dims.max>20 && dims.scrollTop>15,'parameter panel did not scroll independently');
      const previewAfter=await viewer.boundingBox();
      assert.ok(previewAfter && Math.abs(previewAfter.y-previewBefore.y)<2 && Math.abs(previewAfter.height-previewBefore.height)<2,
        '3D viewer moved when scrolling parameters');
      await page.screenshot({path:path.join(output,device.name+'-split-locked.png'),fullPage:true});
      await page.getByRole('button',{name:'Unlock viewer and parameters layout'}).click();
      assert.equal(await workspace.getAttribute('data-layout-locked'),'false');
    });

    await step('parameter controls loaded from main.scad', async () => {
      const width = page.getByRole('textbox', { name: 'Width', exact: true });
      await width.waitFor({ state: 'visible' });
      assert.equal(await width.inputValue(), '16');
      const height = page.getByRole('textbox', { name: 'Height', exact: true });
      assert.equal(await height.inputValue(), '12');
    });

    await page.getByRole('button', { name: 'Open main.scad' }).click();
    const dialog = page.getByRole('dialog');
    const toolbar = dialog.getByRole('navigation', { name: 'OpenSCAD editor tools' });
    const selector = toolbar.getByRole('combobox', { name: 'Open project file' });
    const textbox = () => dialog.getByRole('textbox', { name: /OpenSCAD source for/i });
    const more = toolbar.getByRole('button', { name: 'More editor tools' });
    const save = toolbar.getByRole('button', { name: 'Save', exact: true });
    const discard = toolbar.getByRole('button', { name: 'Discard', exact: true });

    await step('upload confirmation does not obscure editor toolbar', async () => {
      // Verify dismissal when editing begins rather than the eventual toast timeout.
      await page.getByText('Model uploaded', { exact: true }).waitFor({ state: 'hidden', timeout: 5000 });
      const search = toolbar.getByRole('button', { name: 'Find / replace' });
      const unobstructed = await search.evaluate(button => {
        const rect = button.getBoundingClientRect();
        const topmost = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return topmost === button || button.contains(topmost);
      });
      assert.ok(unobstructed, 'find button is covered by a notification or overlay');
      await page.screenshot({ path: path.join(output, device.name + '-editor-toolbar-after-import.png'), fullPage: true });
    });

    const mainSource = await read(textbox());
    assert.ok(mainSource.includes('use <lib/geometry.scad>'));

    await step('Swedish text and caret positioning with mobile-style input', async () => {
      await textbox().fill('cube(10);');
      await textbox().focus();
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.insertText('\n// mått: åäö ÅÄÖ');
      const entered = await read(textbox());
      assert.equal(entered.split('// mått: åäö ÅÄÖ').length - 1, 1, 'Swedish text missing or duplicated');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.insertText('X');
      assert.ok((await read(textbox())).includes('// mått: åäö ÅÄXÖ'), 'caret changed position while inserting');
      await page.keyboard.press('Backspace');
      assert.ok((await read(textbox())).includes('// mått: åäö ÅÄÖ'), 'backspace changed wrong character');
      await page.screenshot({ path: path.join(output, device.name + '-unicode-editor.png'), fullPage: true });
      await more.click();
      await discard.click();
      assert.equal(await read(textbox()), mainSource, 'Discard after Unicode typing did not restore file');
    });

    await step('synthetic composition events do not duplicate committed text', async () => {
      // Only synthetic composition event coverage: NOT a physical OS or Android IME.
      await textbox().fill('// sammansättning: ');
      await textbox().focus();
      await page.keyboard.press('ControlOrMeta+End');
      await textbox().evaluate(element => {
        element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
      });
      await page.keyboard.insertText('räv');
      await textbox().evaluate(element => {
        element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'räv' }));
      });
      await page.waitForTimeout(100);
      const composed = await read(textbox());
      assert.equal(composed, '// sammansättning: räv', 'composition text was lost or duplicated');
      await more.click();
      await discard.click();
      assert.equal(await read(textbox()), mainSource, 'Discard after composition did not restore file');
    });

    await step('auto-brackets and keyboard completion', async () => {
      await textbox().fill('');
      await textbox().focus();
      await page.keyboard.type('cube(', { delay: 35 });
      assert.equal(await read(textbox()), 'cube()', 'opening parenthesis did not insert matching close');
      await page.keyboard.insertText('10');
      assert.equal(await read(textbox()), 'cube(10)', 'caret was not placed inside automatically closed brackets');
      await textbox().fill('sphe');
      await textbox().focus();
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.press('ControlOrMeta+Space');
      await page.locator('.cm-tooltip-autocomplete').waitFor({ state: 'visible', timeout: 8000 });
      // CodeMirror suppresses accidental Enter acceptance within its 75 ms safety window.
      await page.waitForTimeout(160);
      await page.keyboard.press('Enter');
      const completed = await read(textbox());
      assert.equal(completed, 'sphere', 'Enter should accept the OpenSCAD completion, not insert a newline');
      await more.click();
      await discard.click();
      assert.equal(await read(textbox()), mainSource, 'Discard after completion did not restore file');
    });

    await step('separate drafts survive switching', async () => {
      await textbox().fill(mainSource + '\n// main draft only');
      await selector.selectOption('lib/geometry.scad');
      const helperSource = await read(textbox());
      assert.ok(helperSource.includes('module make_block'));
      await textbox().fill(helperSource + '\n// helper draft only');
      await selector.selectOption('main.scad');
      assert.ok((await read(textbox())).includes('// main draft only'), 'main draft was lost');
      await selector.selectOption('lib/geometry.scad');
      assert.ok((await read(textbox())).includes('// helper draft only'), 'helper draft was lost');
    });

    await step('discard affects only selected file', async () => {
      await more.click();
      await discard.click();
      assert.equal((await read(textbox())).includes('// helper draft only'), false, 'helper draft not discarded');
      await selector.selectOption('main.scad');
      assert.ok((await read(textbox())).includes('// main draft only'), 'discard unexpectedly erased main draft');
    });

    await step('save one file without losing the other draft', async () => {
      await selector.selectOption('lib/geometry.scad');
      await textbox().fill((await read(textbox())) + '\n// helper saved');
      await save.click();
      // The dialog remains visible during asynchronous persistence; visibility
      // alone does not mean onSaveFile has resolved. Wait for the clean state.
      await dialog.getByText('Saved', { exact: true }).waitFor({ state: 'visible', timeout: 25000 });
      await selector.selectOption('main.scad');
      assert.ok((await read(textbox())).includes('// main draft only'));
      await textbox().fill((await read(textbox())) + '\n// main saved');
      await save.click();
      await dialog.waitFor({ state: 'hidden', timeout: 35000 });
    });

    await step('saved files survive reopening and include reference', async () => {
      await page.getByRole('button', { name: 'Open main.scad' }).click();
      assert.ok((await read(textbox())).includes('// main saved'));
      await selector.selectOption('lib/geometry.scad');
      assert.ok((await read(textbox())).includes('// helper saved'));
      await selector.selectOption('main.scad');
      const current = await read(textbox());
      await textbox().fill(current.replace('use <lib/geometry.scad>', 'include <lib/geometry.scad>'));
      await save.click();
      await dialog.waitFor({ state: 'hidden', timeout: 35000 });
      await page.getByRole('button', { name: 'Open main.scad' }).click();
      assert.ok((await read(textbox())).includes('include <lib/geometry.scad>'));
      await dialog.getByRole('button', { name: 'Close' }).click();
      await dialog.waitFor({ state: 'hidden' });
    });

    await step('parameter input persists into source without replacing helper', async () => {
      const width = page.getByRole('textbox', { name: 'Width', exact: true });
      await width.waitFor({ state: 'visible' });
      await width.fill('22');
      await width.press('Tab');
      await page.getByRole('button', { name: 'Open main.scad' }).click();
      await textbox().waitFor({ state: 'visible' });
      await page.waitForFunction(() => {
        const editor = document.querySelector('[aria-label="OpenSCAD source for main.scad"]');
        return Boolean(editor?.textContent?.includes('width = 22;'));
      }, null, { timeout: 18000 });
      assert.ok((await read(textbox())).includes('include <lib/geometry.scad>'));
      await dialog.getByRole('button', { name: 'Close' }).click();
      await dialog.waitFor({ state: 'hidden' });
    });

    await step('rendered model and no horizontal overflow', async () => {
      await page.waitForFunction(() => Array.from(document.querySelectorAll('canvas'))
        .some(el => el.getBoundingClientRect().height > 40 && el.getBoundingClientRect().width > 40),
        null, { timeout: 85000 });
      const dimensions = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        width: window.innerWidth,
      }));
      assert.ok(dimensions.scroll <= dimensions.width + 2, JSON.stringify(dimensions));
      assert.deepEqual(errors, [], 'browser exceptions occurred');
      await page.screenshot({ path: path.join(output, device.name + '-multifile-final.png'), fullPage: true });
    });
  } catch (error) {
    failed = true;
    results.push({
      device: device.name,
      name: checkpoint,
      status: 'FAIL',
      error: String(error?.stack ?? error).slice(0, 2200),
    });
    console.error('[' + device.name + '] FAIL ' + checkpoint, error);
    await page.screenshot({ path: path.join(output, device.name + '-multifile-failure.png'), fullPage: true }).catch(() => {});
  } finally {
    await context.close();
  }
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      if ((await fetch(origin)).ok) { ready = true; break; }
    } catch {
      // HTTP server may still be starting.
    }
    if (server.exitCode !== null) break;
    await sleep(250);
  }
  assert.ok(ready, 'Static preview did not start: ' + serverErrors);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-dev-shm-usage', '--enable-unsafe-swiftshader'] });
  await deviceCheck({ name: 'desktop', width: 1440, height: 900, mobile: false });
  await deviceCheck({ name: 'mobile', width: 390, height: 844, mobile: true });
} catch (error) {
  failed = true;
  results.push({ device: 'runner', name: 'startup', status: 'FAIL', error: String(error?.stack ?? error).slice(0, 2200) });
  console.error(error);
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
const report = { testedAt: new Date().toISOString(), sha: process.env.GITHUB_SHA ?? null, results, note: 'Mobile is Chromium touch emulation, not a physical Android keyboard.' };
await writeFile(path.join(output, 'multifile-results.json'), JSON.stringify(report, null, 2) + '\n');
console.log('MULTIFILE_EDITOR_RESULTS=' + JSON.stringify(report));
if (failed) process.exitCode = 1;
