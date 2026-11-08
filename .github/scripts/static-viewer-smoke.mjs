import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, stat, mkdtemp, symlink, rm } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { tmpdir } from 'node:os';
import path from 'node:path';

const origin = 'http://127.0.0.1:4179';
const basePath = process.env.STATIC_VIEWER_BASE || '/';
// Serve at the real deployment path. A custom-domain Pages site serves at /;
// the default github.io project site serves at /brepia_viewer/.
const isRootSite = basePath === '/';
const siteRoot = isRootSite
  ? path.resolve('.output/public')
  : await mkdtemp(path.join(tmpdir(), 'brepia-pages-smoke-'));
if (!isRootSite) {
  await symlink(path.resolve('.output/public'), path.join(siteRoot, basePath.slice(1, -1)), 'dir');
}
const evidence = process.env.RUNNER_TEMP
  ? path.join(process.env.RUNNER_TEMP, 'viewer-static-evidence')
  : path.join(process.cwd(), '.output', 'static-evidence');

await mkdir(evidence, { recursive: true });
const server = spawn('python3', ['-m', 'http.server', '4179', '--bind', '127.0.0.1', '--directory', siteRoot], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverError = '';
server.stderr.on('data', data => { serverError += data.toString().slice(-2000); });
let browser;
const findings = [];
const violations = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

try {
  let ready = false;
  for (let i=0;i<45;i++) {
    try {
      const res=await fetch(origin + basePath);
      if(res.ok) {ready=true;break;}
    } catch {
      // Retry while the test HTTP server is starting.
    }
    if(server.exitCode !== null) break;
    await sleep(250);
  }
  if (!ready) throw new Error('Static HTTP server unavailable: ' + serverError);
  const rootHtml=await (await fetch(origin+basePath)).text();
  findings.push({type:'root-html',byteLength:rootHtml.length,snippet:rootHtml.slice(0,1500)});
  if(!rootHtml.includes(`${basePath}assets/`)) violations.push('Wrong GitHub Pages asset base');

  for (const endpoint of [basePath, `${basePath}privacy-policy`, `${basePath}terms-of-service`]) {
    const response=await fetch(origin+endpoint);
    findings.push({type:'static-http',path:endpoint,status:response.status,contentType:response.headers.get('content-type'),bytes:Number(response.headers.get('content-length')||0)});
    if(endpoint===basePath && !response.ok) violations.push('root HTTP failed');
    if(!response.ok) violations.push(`Page ${endpoint} returned HTTP ${response.status}`);
  }

  browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-dev-shm-usage','--enable-unsafe-swiftshader']});

  for(const device of [{name:'desktop',width:1440,height:900},{name:'mobile',width:390,height:844}]) {
    const context=await browser.newContext({viewport:{width:device.width,height:device.height},acceptDownloads:true,serviceWorkers:'block'});
    const page=await context.newPage();
    const errors=[],failedRequests=[],apiRequests=[],wasm=[],assetHttpFailures=[],wasmStatuses=[];
    page.on('response',res=>{
      if(res.url().startsWith(origin+basePath) && res.status()>=400) assetHttpFailures.push({url:res.url().slice(0,150),status:res.status()});
      if(res.url().endsWith('.wasm')) wasmStatuses.push(res.status());
    });
    page.on('pageerror',err=>errors.push(err.message.slice(0,300)));
    page.on('requestfailed',req=>failedRequests.push({url:req.url().slice(0,180),reason:req.failure()?.errorText}));
    page.on('request',req=>{
      if (req.url().includes('/api/')) apiRequests.push(req.url().slice(0,160));
      if (req.url().includes('openscad') || req.url().endsWith('.wasm')) wasm.push(req.url().slice(0,170));
    });
    const t0=Date.now();
    const response=await page.goto(origin+basePath,{waitUntil:'domcontentloaded',timeout:45000});
    await page.getByText('Model gallery',{exact:true}).first().waitFor({timeout:35000});
    const repositoryLink = page.getByRole('link',{name:'View Brepia Viewer repository on GitHub'});
    const assertRepositoryLink = async (view) => {
      const links = await repositoryLink.count();
      if (links !== 1) {
        violations.push(device.name+' '+view+' GitHub repository link count: '+links);
        return;
      }
      const link = repositoryLink.first();
      const href = await link.getAttribute('href');
      const target = await link.getAttribute('target');
      const rel = (await link.getAttribute('rel'))?.split(/\s+/) || [];
      if (href !== 'https://github.com/weaf/brepia_viewer') violations.push(device.name+' '+view+' GitHub repository URL mismatch');
      if (target !== '_blank' || !rel.includes('noopener') || !rel.includes('noreferrer')) violations.push(device.name+' '+view+' GitHub link missing safe new-tab attributes');
      if (!(await link.isVisible())) violations.push(device.name+' '+view+' GitHub repository link not visible');
      if ((await link.locator('svg').count()) < 1) violations.push(device.name+' '+view+' GitHub icon missing');
    };
    await assertRepositoryLink('gallery');
    const tGallery=Date.now()-t0;
    const body=await page.locator('body').innerText();
    await page.screenshot({path:path.join(evidence,device.name+'-gallery.png'),fullPage:true});
    if(!body.includes('Upload model')) violations.push(device.name+' missing upload button');

    await page.locator('input[type=file]').first().setInputFiles({
      name:'cube-static-smoke.scad',
      mimeType:'text/plain',
      buffer:Buffer.from("/* [Dimensions] */\nwidth = 10; // [5:1:30]\nheight = 10; // [5:1:30]\nextra_01 = 1; // [0:1:100]\nextra_02 = 2; // [0:1:100]\nextra_03 = 3; // [0:1:100]\nextra_04 = 4; // [0:1:100]\nextra_05 = 5; // [0:1:100]\nextra_06 = 6; // [0:1:100]\nextra_07 = 7; // [0:1:100]\nextra_08 = 8; // [0:1:100]\nextra_09 = 9; // [0:1:100]\nextra_10 = 10; // [0:1:100]\nextra_11 = 11; // [0:1:100]\nextra_12 = 12; // [0:1:100]\nextra_13 = 13; // [0:1:100]\nextra_14 = 14; // [0:1:100]\nextra_15 = 15; // [0:1:100]\nextra_16 = 16; // [0:1:100]\nextra_17 = 17; // [0:1:100]\nextra_18 = 18; // [0:1:100]\ncube([width,width,height], center=true);\n"),
    });
    await page.getByText('Source and parameters',{exact:true}).first().waitFor({timeout:40000});
    await assertRepositoryLink('model editor');
    // The model header is one row on desktop and at most two rows on mobile.
    const modelHeader=page.getByTestId('model-editor-header');
    const modelHeaderBounds=await modelHeader.boundingBox();
    if(!modelHeaderBounds || modelHeaderBounds.height > (device.name==='mobile' ? 122 : 68)) {
      violations.push(device.name+' model actions consume too many rows: '+JSON.stringify(modelHeaderBounds));
    }
    for(const action of [
      page.getByRole('link',{name:'View Brepia Viewer repository on GitHub'}),
      modelHeader.getByRole('button',{name:'Export model'}),
      modelHeader.getByRole('button',{name:'Save',exact:true}),
      modelHeader.getByRole('button',{name:'Clear local data'}),
    ]) {
      const rect=await action.boundingBox();
      if(!rect || rect.height<40 || rect.x<0 || rect.x+rect.width>device.width+2) {
        violations.push(device.name+' model toolbar action is not compact/touchable: '+JSON.stringify(rect));
      }
    }
    const modelWorkspace=page.getByTestId('model-workspace');
    const parameterScroller=page.getByTestId('model-parameters-scroll');
    const previewPane=page.getByRole('region',{name:'3D model preview'});
    const originalPreview=await previewPane.boundingBox();
    const lockButton=page.getByRole('button',{name:'Lock viewer and parameters layout'});
    await lockButton.click();
    if(await modelWorkspace.getAttribute('data-layout-locked')!=='true') {
      violations.push(device.name+' layout lock did not activate');
    }
    const lockedPreview=await previewPane.boundingBox();
    if(!lockedPreview || lockedPreview.height<95 || lockedPreview.y<0 ||
       lockedPreview.y+lockedPreview.height>device.height+2) {
      violations.push(device.name+' locked viewer does not fit the viewport: '+JSON.stringify(lockedPreview));
    }
    const scrolling=await parameterScroller.evaluate(node=>{
      const max=node.scrollHeight-node.clientHeight;
      node.scrollTop=max;
      return {max,top:node.scrollTop,clientHeight:node.clientHeight,scrollHeight:node.scrollHeight};
    });
    const previewAfterScroll=await previewPane.boundingBox();
    if(scrolling.max<25 || scrolling.top<20) {
      violations.push(device.name+' parameters did not scroll independently: '+JSON.stringify(scrolling));
    }
    if(lockedPreview && previewAfterScroll &&
       (Math.abs(lockedPreview.y-previewAfterScroll.y)>2 ||
        Math.abs(lockedPreview.height-previewAfterScroll.height)>2)) {
      violations.push(device.name+' locked viewer moved when parameter list scrolled');
    }
    await page.screenshot({path:path.join(evidence,device.name+'-viewer-layout-locked.png'),fullPage:true});
    await page.getByRole('button',{name:'Unlock viewer and parameters layout'}).click();
    if(await modelWorkspace.getAttribute('data-layout-locked')!=='false') {
      violations.push(device.name+' unlocking layout did not restore default mode');
    }
    if(device.name==='mobile') {
      const normal=await modelWorkspace.evaluate(node=>({
        scrollHeight:node.scrollHeight,clientHeight:node.clientHeight,
        overflow:getComputedStyle(node).overflowY,
      }));
      if(normal.scrollHeight<=normal.clientHeight+20 || normal.overflow==='hidden') {
        violations.push(device.name+' unlocked view did not restore page scrolling: '+JSON.stringify(normal));
      }
    }
    findings.push({type:'locked-parameter-layout',device:device.name,header:modelHeaderBounds,
      initial:originalPreview,locked:lockedPreview,scroller:scrolling});
    // Project source UI: file action, compact editor and Save/Discard on one row.
    const openSourceButton = page.getByRole('button',{name:/^Open .+\.scad$/i}).first();
    await openSourceButton.waitFor({timeout:30000});
    const openBounds = await openSourceButton.boundingBox();
    const openStyle = await openSourceButton.evaluate(el => {
      const style = getComputedStyle(el);
      return {background: style.backgroundColor, weight: style.fontWeight};
    });
    if(!openBounds || openBounds.height < 36 || Number(openStyle.weight) < 600 ||
       openStyle.background === 'rgba(0, 0, 0, 0)') {
      violations.push(device.name+' Open file button is not prominent or touch friendly');
    }
    if(await page.getByText('Entrypoint',{exact:true}).count()) violations.push(device.name+' legacy entrypoint label still visible');
    await openSourceButton.click();
    const sourceDialog = page.getByRole('dialog');
    await sourceDialog.waitFor({timeout:15000});
    const initialDialogBounds = await sourceDialog.boundingBox();
    const viewport = page.viewportSize();
    const minDialogRatio = device.name === 'mobile' ? 0.9 : 0.82;
    if(!initialDialogBounds || initialDialogBounds.height < viewport.height * minDialogRatio) {
      violations.push(device.name+' source editor does not use enough vertical space');
    }
    const expandEditor = sourceDialog.getByRole('button',{name:'Expand editor'});
    await expandEditor.click();
    await sourceDialog.getByRole('button',{name:'Restore editor'}).waitFor({timeout:5000});
    await page.waitForTimeout(250);
    const expandedDialogBounds = await sourceDialog.boundingBox();
    if(!expandedDialogBounds || !initialDialogBounds ||
       expandedDialogBounds.height < initialDialogBounds.height + 10 ||
       expandedDialogBounds.width < initialDialogBounds.width - 2) {
      violations.push(device.name+' Expand editor did not enlarge the workspace');
    }
    await page.screenshot({path:path.join(evidence,device.name+'-source-expanded.png'),fullPage:true});
    await sourceDialog.getByRole('button',{name:'Restore editor'}).click();
    await sourceDialog.getByRole('button',{name:'Expand editor'}).waitFor({timeout:5000});
    try {
      await page.waitForFunction(expectedHeight => {
        const dialog = document.querySelector('[role="dialog"]');
        return !!dialog && Math.abs(dialog.getBoundingClientRect().height - expectedHeight) < 6;
      }, initialDialogBounds.height, {timeout:5000});
    } catch {
      // The size mismatch is recorded in the explicit assertion below.
    }
    const restoredDialogBounds = await sourceDialog.boundingBox();
    findings.push({type:'source-editor-layout',device:device.name,open:openBounds,openStyle,initial:initialDialogBounds,expanded:expandedDialogBounds,restored:restoredDialogBounds});
    if(!restoredDialogBounds || !initialDialogBounds ||
       Math.abs(restoredDialogBounds.height - initialDialogBounds.height) > 6) {
      violations.push(device.name+' Restore editor did not restore its size');
    }
    const editorToolbar=sourceDialog.getByRole('navigation',{name:'OpenSCAD editor tools'});
    const sourceTextbox=sourceDialog.getByRole('textbox',{name:/OpenSCAD source for/i});
    const saveSource=editorToolbar.getByRole('button',{name:'Save',exact:true});
    const moreTools=editorToolbar.getByRole('button',{name:'More editor tools'});
    const insertCode=editorToolbar.getByRole('button',{name:'Insert OpenSCAD code'});
    await sourceTextbox.waitFor({timeout:15000});
    await saveSource.waitFor({timeout:15000});
    const toolbarBounds=await editorToolbar.boundingBox();
    if(!toolbarBounds || toolbarBounds.height>50) {
      violations.push(device.name+' editor toolbar should fit one compact row');
    }
    const visibleDescription=sourceDialog.locator('p').filter({hasText:'Edit the project entrypoint'});
    if(await visibleDescription.count()) violations.push(device.name+' legacy editor description still rendered');
    const editSurface=sourceDialog.locator('.cm-editor');
    if(await editSurface.count()!==1) violations.push(device.name+' CodeMirror editor surface missing');

    await page.screenshot({path:path.join(evidence,device.name+'-source-dialog.png'),fullPage:true});
    const readSource=()=>sourceTextbox.innerText();
    const originalSource=await readSource();

    // The ellipsis menu exposes the same CodeMirror history as keyboard Undo / Redo.
    await moreTools.click();
    const undoAction = editorToolbar.getByRole('button',{name:'Undo',exact:true});
    const redoAction = editorToolbar.getByRole('button',{name:'Redo',exact:true});
    if(!(await undoAction.isDisabled()) || !(await redoAction.isDisabled())) {
      violations.push(device.name+' Undo / Redo should be disabled before editing');
    }
    await moreTools.click();
    await sourceTextbox.fill(originalSource+'\n// undo redo history check');
    await moreTools.click();
    if(await undoAction.isDisabled()) violations.push(device.name+' Undo not enabled after edit');
    await undoAction.click();
    if(await readSource()!==originalSource) violations.push(device.name+' Undo did not restore original source');
    await moreTools.click();
    if(await redoAction.isDisabled()) violations.push(device.name+' Redo not enabled after Undo');
    await redoAction.click();
    if(!(await readSource()).includes('// undo redo history check')) {
      violations.push(device.name+' Redo did not restore the edit');
    }
    await moreTools.click();
    await undoAction.click();
    if(await readSource()!==originalSource) violations.push(device.name+' second Undo failed');

    // Closing with changes must require explicit user confirmation.
    await sourceTextbox.fill(originalSource+'\n// close guard test');
    page.once('dialog',dialog=>{ void dialog.dismiss(); });
    await sourceDialog.getByRole('button',{name:'Close'}).click();
    if(!(await sourceDialog.isVisible())) violations.push(device.name+' dirty draft was closed without consent');

    await moreTools.click();
    const discardSource=editorToolbar.getByRole('button',{name:'Discard',exact:true});
    await discardSource.click();
    if(await readSource()!==originalSource) violations.push(device.name+' Discard failed to restore source');

    // The category picker must remain icon-dense, keyboard accessible, and searchable.
    await insertCode.click();
    const snippetPanel=editorToolbar.locator('.scad-editor__panel--wide');
    const paletteMetrics=await snippetPanel.evaluate(panel=>{
      const rect=panel.getBoundingClientRect();
      const buttons=[...panel.querySelectorAll('.scad-editor__snippet')];
      const first=buttons[0];
      const target=first?.getBoundingClientRect();
      return {height:rect.height,visible:buttons.length,targetWidth:target?.width,targetHeight:target?.height,
        labeledCount:buttons.filter(button=>button.querySelector('svg') && button.querySelector('.scad-editor__snippet-caption')?.textContent?.trim()).length,
        gridColumns:getComputedStyle(panel.querySelector('.scad-editor__snippet-grid')).gridTemplateColumns.split(' ').length,
        labels:buttons.map(button=>button.querySelector('.scad-editor__snippet-caption')?.textContent?.trim()),
        labelsOverflow:buttons.filter(button=>{const caption=button.querySelector('.scad-editor__snippet-caption');return caption && caption.scrollWidth > caption.clientWidth + 1;}).length};
    });
    if(paletteMetrics.height>370 || paletteMetrics.visible>9 ||
       paletteMetrics.labeledCount!==paletteMetrics.visible ||
       paletteMetrics.gridColumns!==6 || paletteMetrics.labelsOverflow>0 ||
       paletteMetrics.targetHeight<40) {
      violations.push(device.name+' OpenSCAD palette is not a compact, readable icon+label grid: '+JSON.stringify(paletteMetrics));
    }
    await page.screenshot({path:path.join(evidence,device.name+'-labeled-insert-menu.png'),fullPage:true});
    for (const [category, expected] of [
      ['Programming', ['Function', 'For', 'If/Else']],
      ['Parameters', ['Slider', 'Group', 'Toggle', '$fn']],
      ['Files', ['Include', 'Use', 'STL', 'SVG']],
    ]) {
      await snippetPanel.getByRole('button',{name:category,exact:true}).click();
      const captions=await snippetPanel.locator('.scad-editor__snippet-caption').allTextContents();
      for (const caption of expected) {
        if (!captions.includes(caption)) violations.push(device.name+' missing '+caption+' label in '+category);
      }
    }
    await snippetPanel.getByRole('button',{name:'Noteringar',exact:true}).click();
    const noteCaptions=await snippetPanel.locator('.scad-editor__snippet-caption').allTextContents();
    for (const label of ['Text','Arrow','2-way','Dimension']) {
      if (!noteCaptions.includes(label)) violations.push(device.name+' Noteringar category missing '+label);
    }
    await page.screenshot({path:path.join(evidence,device.name+'-annotations-menu.png'),fullPage:true});
    await snippetPanel.getByRole('button',{name:'Text',exact:true}).click();
    if(!(await readSource()).includes('linear_extrude(height = 3)')) {
      violations.push(device.name+' Noteringar Text did not insert extruded text');
    }
    await moreTools.click();
    await undoAction.click();
    if((await readSource()).includes('linear_extrude(height = 3)')) {
      violations.push(device.name+' Undo failed for inserted Noteringar snippet');
    }
    await moreTools.click();
    await redoAction.click();
    if(!(await readSource()).includes('linear_extrude(height = 3)')) {
      violations.push(device.name+' Redo failed for inserted Noteringar snippet');
    }
    await moreTools.click();
    await discardSource.click();
    await insertCode.click();
    await snippetPanel.getByRole('button',{name:'Noteringar',exact:true}).click();
    await snippetPanel.getByRole('button',{name:'Dimension',exact:true}).click();
    if(!(await readSource()).includes('text(str(dimension_length, " mm")')) {
      violations.push(device.name+' Noteringar Dimension did not insert dimension lines and label');
    }
    await moreTools.click();
    await discardSource.click();
    await insertCode.click();
    await snippetPanel.getByRole('button',{name:'Templates',exact:true}).click();
    await snippetPanel.getByRole('button',{name:'Tube',exact:true}).click();
    if(!(await readSource()).includes('difference()')) {
      violations.push(device.name+' ready-made Tube template did not insert');
    }
    await moreTools.click();
    await discardSource.click();
    if(await readSource()!==originalSource) violations.push(device.name+' Discard after ready-made template failed');

    await insertCode.click();
    await snippetPanel.getByRole('searchbox',{name:'Search OpenSCAD snippets'}).fill('cylind');
    if(!(await snippetPanel.getByRole('button',{name:'Cylinder',exact:true}).isVisible())) {
      violations.push(device.name+' search did not reveal Cylinder');
    }
    await snippetPanel.getByRole('button',{name:'Shapes',exact:true}).click();
    await editorToolbar.getByRole('button',{name:'Cube',exact:true}).click();
    if(!(await readSource()).includes('cube([10, 10, 10], center = true);')) {
      violations.push(device.name+' OpenSCAD snippet menu did not insert Cube');
    }
    await moreTools.click();
    await discardSource.click();
    if(await readSource()!==originalSource) violations.push(device.name+' Discard did not restore after snippet insertion');

    await sourceTextbox.fill(originalSource+'\n// saved UI smoke test');
    await saveSource.click();
    await sourceDialog.waitFor({state:'hidden',timeout:35000});
    await openSourceButton.click();
    const savedSourceDialog=page.getByRole('dialog');
    const savedSource=await savedSourceDialog.getByRole('textbox',{name:/OpenSCAD source for/i}).innerText();
    if(!savedSource.includes('// saved UI smoke test')) violations.push(device.name+' Save failed to persist edited source');
    // A success toast from saving can temporarily cover the mobile editor's
    // close control. Dismiss it as a user would before testing the dialog.
    for (let i=0; i<3; i++) {
      const toastClose = page.locator('button[toast-close]');
      if (!(await toastClose.count())) break;
      await toastClose.first().click({force:true,timeout:2500});
    }
    await savedSourceDialog.getByRole('button',{name:'Close'}).click();
    let visibleCanvas=false;
    try {
      await page.waitForFunction(()=>Array.from(document.querySelectorAll('canvas')).some(x=>x.getBoundingClientRect().width>40 && x.getBoundingClientRect().height>40),null,{timeout:85000});
      visibleCanvas=true;
    } catch {
      // Missing 3D canvas is reported through the test violations below.
    }
    await page.waitForTimeout(2500);
    const tEditor=Date.now()-t0;
    const snapshot=await page.evaluate(()=>({
      body:document.body.innerText.slice(0,420),
      canvasCount:document.querySelectorAll('canvas').length,
      docWidth:document.documentElement.scrollWidth,
      viewportWidth:innerWidth,
      navigation:performance.getEntriesByType('navigation').map(e=>({duration:e.duration,domContentLoaded:e.domContentLoadedEventEnd,transferSize:e.transferSize})),
    }));
    await page.screenshot({path:path.join(evidence,device.name+'-editor.png'),fullPage:true});
    let stlExport=null;
    try {
      await page.getByRole('button',{name:'Export model'}).click({timeout:30000});
      const stepMenuCount=await page.getByRole('menuitem',{name:/\.STEP/}).count();
      if(stepMenuCount) violations.push(device.name+' static export menu still exposes STEP');
      const [download]=await Promise.all([
        page.waitForEvent('download',{timeout:40000}),
        page.getByRole('menuitem',{name:/\.STL/}).first().click({timeout:10000}),
      ]);
      const filename=download.suggestedFilename();
      const output=path.join(evidence,device.name+'-cube.stl');
      await download.saveAs(output);
      const file=await stat(output);
      stlExport={filename,bytes:file.size};
      if (!filename.endsWith('.stl') || file.size<100) violations.push(device.name+' STL export invalid');
    } catch (e) {
      stlExport={error:String(e?.message||e).slice(0,250)};
      violations.push(device.name+' STL export failed');
    }
    // Orca-specific export must also work in the static production bundle.
    // This smoke fixture is monochrome; per-color mapping is covered in
    // orcaThreeMfExport.test.ts and requires separate real-slicer acceptance.
    let orcaColorExport = null;
    try {
      await page.getByRole('button',{name:'Export model'}).click({timeout:30000});
      const [orcaDownload] = await Promise.all([
        page.waitForEvent('download',{timeout:40000}),
        page.getByRole('menuitem',{name:/Orca Color [.]3MF/}).first().click({timeout:10000}),
      ]);
      const filename = orcaDownload.suggestedFilename();
      const outputPath = path.join(evidence,device.name+'-cube.orca.3mf');
      await orcaDownload.saveAs(outputPath);
      const byteCount = (await stat(outputPath)).size;
      const archive = unzipSync(new Uint8Array(await readFile(outputPath)));
      const xml = new TextDecoder().decode(archive['3D/3dmodel.model']);
      orcaColorExport={filename,bytes:byteCount,triangleCount:(xml.match(/<triangle /g)||[]).length};
      if (!filename.endsWith('.orca.3mf') || byteCount < 200 || !xml.includes('unit="millimeter"')
          || !xml.includes('<triangle ')) {
        violations.push(device.name+' Orca 3MF export invalid');
      }
    } catch(e) {
      orcaColorExport={error:String(e?.message||e).slice(0,250)};
      violations.push(device.name+' Orca 3MF export failed');
    }
    // Preview-only acceptance: compile the real public models using the same
    // OpenSCAD 2025 WASM as the user, then inspect the exported Orca ZIPs.
    // This is not exercised on production-root builds.
    if (device.name === 'desktop' && basePath === '/orca-parts-preview/') {
      const realFixtures = [
        {name:'megabot-print-layout', remote:'Big%20Hero%20Megabot/Bighero_megabot.scad', mode:'print_layout'},
        {name:'megabot-assembled', remote:'Big%20Hero%20Megabot/Bighero_megabot.scad', mode:'assembled'},
        {name:'chain-ring', remote:'Chain_ring/key_ring.scad'},
      ];
      for (const fixture of realFixtures) {
        const result = {type:'real-orca-parts', fixture:fixture.name};
        try {
          const sourceUrl = 'https://raw.githubusercontent.com/Noty-design/Parametric-designs/main/' + fixture.remote;
          const response = await fetch(sourceUrl);
          if (!response.ok) throw new Error('Source HTTP ' + response.status);
          let scad = await response.text();
          if (fixture.mode) {
            const original = 'view_mode = "print_layout";';
            if (!scad.includes(original)) throw new Error('Megabot view_mode setting missing');
            scad = scad.replace(original, 'view_mode = "' + fixture.mode + '";');
          }
          await page.goto(origin + basePath, {waitUntil:'domcontentloaded',timeout:45000});
          await page.getByText('Model gallery',{exact:true}).first().waitFor({timeout:30000});
          await page.locator('input[type=file]').first().setInputFiles({
            name:fixture.name+'.scad', mimeType:'text/plain', buffer:Buffer.from(scad),
          });
          await page.getByText('Source and parameters',{exact:true}).first().waitFor({timeout:45000});
          await page.locator('section[aria-label="3D model preview"] canvas').first().waitFor({state:'visible',timeout:300000});
          await page.getByRole('button',{name:'Export model'}).click({timeout:30000});
          const [download] = await Promise.all([
            page.waitForEvent('download',{timeout:120000}),
            page.getByRole('menuitem',{name:/Orca Parts [.]3MF/}).first().click({timeout:15000}),
          ]);
          const filePath = path.join(evidence,fixture.name+'.orca-parts.3mf');
          await download.saveAs(filePath);
          const archive = unzipSync(new Uint8Array(await readFile(filePath)));
          const model = new TextDecoder().decode(archive['3D/3dmodel.model']);
          const metadata = archive['Metadata/model_settings.config']
            ? new TextDecoder().decode(archive['Metadata/model_settings.config']) : '';
          const settings = archive['Metadata/project_settings.config']
            ? JSON.parse(new TextDecoder().decode(archive['Metadata/project_settings.config'])) : {};
          result.fileBytes = (await stat(filePath)).size;
          result.triangles = (model.match(/<triangle /g)||[]).length;
          result.buildItems = (model.match(/<item objectid=/g)||[]).length;
          result.components = (model.match(/<component objectid=/g)||[]).length;
          result.meshObjects = (model.match(/<object id="[^"]+" type="model"[^>]*><mesh>/g)||[]).length;
          result.paintFaces = (model.match(/paint_color=/g)||[]).length;
          result.metadataParts = (metadata.match(/<part id=/g)||[]).length;
          result.metadataExtruders = (metadata.match(/key="extruder" value="/g)||[]).length;
          result.palette = settings.filament_colour || [];
          result.objectNames = [...model.matchAll(/<object id="[^"]+" type="model" name="([^"]*)"/g)]
            .map(match=>match[1]).slice(0,35);
          result.toast = (await page.locator('[data-sonner-toast],[role="status"]').allTextContents())
            .join(' ').slice(0,500);
          result.filePath = filePath;
          if (!result.triangles || !result.fileBytes || !model.includes('unit="millimeter"')) {
            throw new Error('3MF has missing triangles, unit, or ZIP content');
          }
          console.log('REAL_ORCA_3MF ' + JSON.stringify(result));
        } catch (error) {
          result.error = String(error?.message || error).slice(0,600);
          violations.push(fixture.name + ' real Orca parts export failed: ' + result.error);
          console.log('REAL_ORCA_3MF_FAILED ' + JSON.stringify(result));
        }
        findings.push(result);
      }
    }

    // The OpenSCAD-only build keeps legal information pages self-contained:
    // they must render in the browser without the retired Supabase/API service.
    for (const legalPage of [
      {route:'privacy-policy',heading:'Privacy Information',message:'No Privacy Policy'},
      {route:'terms-of-service',heading:'Terms of Service',message:'No Terms of Service'},
    ]) {
      await page.goto(origin+basePath+legalPage.route,{waitUntil:'domcontentloaded',timeout:45000});
      await page.getByRole('heading',{name:legalPage.heading,exact:true}).waitFor({timeout:20000});
      const legalBody=await page.locator('body').innerText();
      if(!legalBody.includes(legalPage.message)) violations.push(device.name+' '+legalPage.route+' fallback notice missing');
    }
    const result={type:'browser',device:device.name,mainStatus:response?.status(),galleryMs:tGallery,editorMs:tEditor,visibleCanvas,stlExport,orcaColorExport,errors,failedRequests:failedRequests.slice(0,10),apiRequests,wasmUrls:wasm.slice(0,8),wasmStatuses,assetHttpFailures,...snapshot};
    findings.push(result);
    if(errors.length) violations.push(device.name+' JS exceptions');
    if(snapshot.docWidth > snapshot.viewportWidth + 2) violations.push(device.name+' horizontal overflow');
    if(!visibleCanvas) violations.push(device.name+' no visible model canvas');
    if(apiRequests.length) violations.push(device.name+' unexpected server API call');
    if(assetHttpFailures.length) violations.push(device.name+' same-origin asset HTTP failures');
    if(!wasmStatuses.includes(200)) violations.push(device.name+' OpenSCAD WASM was not loaded successfully');
    await context.close();
  }
} catch (error) {
  violations.push(String(error?.stack||error).slice(0,2000));
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
  if (!isRootSite) await rm(siteRoot,{recursive:true,force:true});
}
const result={testedAt:new Date().toISOString(),siteType:'GitHub Pages project subpath prerendered build',basePath,findings,violations};
await writeFile(path.join(evidence,'results.json'),JSON.stringify(result,null,2)+'\n');
console.log('STATIC_SMOKE_RESULTS='+JSON.stringify(result));
if(violations.length) process.exitCode=1;
