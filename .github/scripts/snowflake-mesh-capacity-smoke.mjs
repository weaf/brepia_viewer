import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

// Pin the owner's actual library source, not a synthetic geometric substitute.
// The test changes only the gallery selection in the uploaded browser copy.
const revision = '06d976968e0d3ae69299e722fe15428a11e71eed';
const sourceUrl = 'https://raw.githubusercontent.com/Noty-design/Parametric-designs/' + revision + '/snowflake/snowflake.scad';
const root = path.resolve('.output/public');
const origin = 'http://127.0.0.1:4198';
const evidence = process.env.RUNNER_TEMP
  ? path.join(process.env.RUNNER_TEMP, 'viewer-fast-preview-evidence')
  : path.resolve('.output/fast-preview-evidence');
await mkdir(evidence, { recursive: true });
const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(20000) });
if (!response.ok) throw new Error('Real Snowflake source unavailable: HTTP ' + response.status);
const source = await response.text();
const selection = 'gallery = "none";';
if (!source.includes(selection) || !source.includes('module gallery_preview(group)')) {
  throw new Error('Pinned Snowflake source no longer matches the acceptance fixture');
}
const server = spawn('python3', ['-m','http.server','4198','--bind','127.0.0.1','--directory',root], { stdio:'ignore' });
let browser;
try {
  let ready = false;
  for (let i=0;i<80;i++) {
    try { if ((await fetch(origin)).ok) { ready=true; break; } } catch { /* startup */ }
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  if (!ready) throw new Error('Static Viewer failed to start');
  browser = await chromium.launch({ channel:'chrome', headless:true, args:['--disable-dev-shm-usage','--enable-unsafe-swiftshader'] });
  const results=[];
  for (const device of [{name:'desktop',width:1440,height:900},{name:'mobile',width:390,height:844}]) {
    const context = await browser.newContext({viewport:{width:device.width,height:device.height},serviceWorkers:'block'});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    try {
      await context.route('https://api.github.com/repos/Noty-design/Parametric-designs/git/trees/**',route=>route.fulfill({
        status:200,contentType:'application/json',body:JSON.stringify({truncated:false,tree:[]}),
      }));
      await page.goto(origin,{waitUntil:'domcontentloaded'});
      await page.getByText('Model gallery',{exact:true}).first().waitFor();
      await page.getByRole('button',{name:'Experimental menu'}).click();
      await page.getByRole('menuitemradio',{name:'Mesh output limit 256 MiB',exact:true}).click();
      const start=Date.now();
      await page.locator('input[type="file"][accept=".scad,.scad.txt"]').setInputFiles({
        name:'snowflake-gallery-3.scad',mimeType:'text/plain',
        buffer:Buffer.from(source.replace(selection,'gallery = "gallery_3";')),
      });
      await page.getByText('Source and parameters',{exact:true}).first().waitFor({timeout:30000});
      await page.getByRole('combobox',{name:'Gallery',exact:true}).waitFor({timeout:30000});
      if (await page.getByRole('combobox',{name:'Gallery',exact:true}).inputValue()!=='gallery_3') {
        throw new Error('Wrong Snowflake gallery fixture');
      }
      const preview=page.getByRole('region',{name:'3D model preview'});
      const canvas=preview.locator('canvas').first();
      await canvas.waitFor({state:'visible',timeout:120000});
      // Inspect pixels from the composited page rather than merely detecting a canvas.
      let painted=0;
      for (let attempt=0;attempt<40;attempt++) {
        const bounds=await canvas.boundingBox();
        if (bounds && bounds.width>=70 && bounds.height>=70) {
          const screenshot=await page.screenshot({clip:{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height}});
          painted=await page.evaluate(async encoded=>{
            const bytes=Uint8Array.from(atob(encoded),char=>char.charCodeAt(0));
            const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
            const surface=document.createElement('canvas');surface.width=bitmap.width;surface.height=bitmap.height;
            const ctx=surface.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
            const pixels=ctx.getImageData(0,0,surface.width,surface.height).data;
            let count=0;
            for(let y=Math.floor(surface.height*0.12);y<surface.height*0.85;y+=3) {
              for(let x=Math.floor(surface.width*0.1);x<surface.width*0.9;x+=3) {
                const i=(y*surface.width+x)*4;
                if (pixels[i+2]>pixels[i]+35 && pixels[i+2]>85 &&
                    Math.max(pixels[i],pixels[i+1],pixels[i+2])-Math.min(pixels[i],pixels[i+1],pixels[i+2])>42) count++;
              }
            }
            return count;
          },screenshot.toString('base64'));
          if(painted>200)break;
        }
        await page.waitForTimeout(300);
      }
      if(painted<=200)throw new Error('Snowflake gallery did not visibly render: '+painted+' painted samples');
      if(await page.getByText('Mesh too large',{exact:true}).isVisible())throw new Error('Mesh capacity error remained');
      if(errors.length)throw new Error('Browser errors: '+errors.join('; '));
      const result={device:device.name,sourceRevision:revision,gallery:'gallery_3',limitMiB:256,
        colorFallback:await page.getByTestId('mesh-output-fallback-notice').isVisible(),paintedSamples:painted,elapsedMs:Date.now()-start};
      results.push(result);
      await page.screenshot({path:path.join(evidence,device.name+'-real-snowflake-gallery3.png')});
      console.log('SNOWFLAKE_CAPACITY_PASS '+JSON.stringify(result));
    } catch(error) {
      await page.screenshot({path:path.join(evidence,device.name+'-real-snowflake-failure.png'),fullPage:true}).catch(()=>{});
      console.error('SNOWFLAKE_CAPACITY_FAIL '+device.name+' '+(await page.locator('body').innerText()).slice(0,2000));
      throw error;
    } finally { await context.close(); }
  }
  console.log('SNOWFLAKE_CAPACITY_RESULTS='+JSON.stringify(results));
} finally { if(browser)await browser.close();server.kill('SIGTERM'); }
