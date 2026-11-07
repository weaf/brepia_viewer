import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, stat, mkdtemp, symlink, rm } from 'node:fs/promises';
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
      buffer:Buffer.from('cube([10,10,10], center=true);\n'),
    });
    await page.getByText('Source and parameters',{exact:true}).first().waitFor({timeout:40000});
    await assertRepositoryLink('model editor');
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
    const saveSource = sourceDialog.getByRole('button',{name:'Save',exact:true});
    const discardSource = sourceDialog.getByRole('button',{name:'Discard',exact:true});
    const sourceTextbox = sourceDialog.getByRole('textbox',{name:/OpenSCAD source for/i});
    await saveSource.waitFor({timeout:15000});
    await discardSource.waitFor({timeout:15000});
    const saveBounds = await saveSource.boundingBox();
    const discardBounds = await discardSource.boundingBox();
    if(!saveBounds || !discardBounds || Math.abs(saveBounds.y-discardBounds.y)>8) {
      violations.push(device.name+' source editor Save/Discard not aligned horizontally');
    }
    const visibleDescription = sourceDialog.locator('p').filter({hasText:'Edit the project entrypoint'});
    if(await visibleDescription.count()) violations.push(device.name+' legacy editor description still rendered');
    await page.screenshot({path:path.join(evidence,device.name+'-source-dialog.png'),fullPage:true});
    const originalSource = await sourceTextbox.inputValue();
    await sourceTextbox.fill(originalSource+'\n// discard test');
    await discardSource.click();
    if(await sourceTextbox.inputValue() !== originalSource) violations.push(device.name+' Discard failed to restore source');
    await sourceTextbox.fill(originalSource+'\n// saved UI smoke test');
    await saveSource.click();
    await sourceDialog.waitFor({state:'hidden',timeout:35000});
    await openSourceButton.click();
    const savedSourceDialog = page.getByRole('dialog');
    const savedSource = await savedSourceDialog.getByRole('textbox',{name:/OpenSCAD source for/i}).inputValue();
    if(!savedSource.includes('// saved UI smoke test')) violations.push(device.name+' Save failed to persist edited source');
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
    const result={type:'browser',device:device.name,mainStatus:response?.status(),galleryMs:tGallery,editorMs:tEditor,visibleCanvas,stlExport,errors,failedRequests:failedRequests.slice(0,10),apiRequests,wasmUrls:wasm.slice(0,8),wasmStatuses,assetHttpFailures,...snapshot};
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
