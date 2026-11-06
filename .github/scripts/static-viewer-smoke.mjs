import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

const origin = 'http://127.0.0.1:4179';
const dir = '.output/public';
const evidence = process.env.RUNNER_TEMP
  ? path.join(process.env.RUNNER_TEMP, 'viewer-static-evidence')
  : path.join(process.cwd(), '.output', 'static-evidence');

await mkdir(evidence, { recursive: true });
const server = spawn('python3', ['-m', 'http.server', '4179', '--bind', '127.0.0.1', '--directory', dir], {
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
      const res=await fetch(origin + '/');
      if(res.ok) {ready=true;break;}
    } catch {}
    if(server.exitCode !== null) break;
    await sleep(250);
  }
  if (!ready) throw new Error('Static HTTP server unavailable: ' + serverError);
  const rootHtml=await (await fetch(origin+'/')).text();
  findings.push({type:'root-html',byteLength:rootHtml.length,snippet:rootHtml.slice(0,1500)});

  for (const endpoint of ['/', '/openscad.wasm', '/privacy-policy', '/terms-of-service']) {
    const response=await fetch(origin+endpoint);
    findings.push({type:'static-http',path:endpoint,status:response.status,contentType:response.headers.get('content-type'),bytes:Number(response.headers.get('content-length')||0)});
    if(endpoint==='/' && !response.ok) violations.push('root HTTP failed');
  }

  browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-dev-shm-usage','--enable-unsafe-swiftshader']});

  for(const device of [{name:'desktop',width:1440,height:900},{name:'mobile',width:390,height:844}]) {
    const context=await browser.newContext({viewport:{width:device.width,height:device.height},acceptDownloads:true,serviceWorkers:'block'});
    const page=await context.newPage();
    const errors=[],failedRequests=[],apiRequests=[],wasm=[];
    page.on('pageerror',err=>errors.push(err.message.slice(0,300)));
    page.on('requestfailed',req=>failedRequests.push({url:req.url().slice(0,180),reason:req.failure()?.errorText}));
    page.on('request',req=>{
      if (req.url().includes('/api/')) apiRequests.push(req.url().slice(0,160));
      if (req.url().includes('openscad') || req.url().endsWith('.wasm')) wasm.push(req.url().slice(0,170));
    });
    const t0=Date.now();
    const response=await page.goto(origin+'/',{waitUntil:'domcontentloaded',timeout:45000});
    await page.getByText('Model gallery',{exact:true}).first().waitFor({timeout:35000});
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
    let visibleCanvas=false;
    try {
      await page.waitForFunction(()=>Array.from(document.querySelectorAll('canvas')).some(x=>x.getBoundingClientRect().width>40 && x.getBoundingClientRect().height>40),null,{timeout:85000});
      visibleCanvas=true;
    } catch {}
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
    const result={type:'browser',device:device.name,mainStatus:response?.status(),galleryMs:tGallery,editorMs:tEditor,visibleCanvas,stlExport,errors,failedRequests:failedRequests.slice(0,10),apiRequests,wasmUrls:wasm.slice(0,8),...snapshot};
    findings.push(result);
    if(errors.length) violations.push(device.name+' JS exceptions');
    if(snapshot.docWidth > snapshot.viewportWidth + 2) violations.push(device.name+' horizontal overflow');
    if(!visibleCanvas) violations.push(device.name+' no visible model canvas');
    if(apiRequests.length) violations.push(device.name+' unexpected server API call');
    await context.close();
  }
} catch (error) {
  violations.push(String(error?.stack||error).slice(0,2000));
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
const result={testedAt:new Date().toISOString(),siteType:'prerendered TanStack Nitro static assets',findings,violations};
await writeFile(path.join(evidence,'results.json'),JSON.stringify(result,null,2)+'\n');
console.log('STATIC_SMOKE_RESULTS='+JSON.stringify(result));
if(violations.length) process.exitCode=1;
