import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {chromium} from '@playwright/test';
const origin='http://127.0.0.1:4201/';
const evidence=path.resolve('.output/partmove-chain-evidence');
await mkdir(evidence,{recursive:true});
const server=spawn('python3',['-m','http.server','4201','--bind','127.0.0.1','--directory',path.resolve('.output/public')],{stdio:'ignore'});
let browser;
try {
  let ready=false;
  for(let i=0;i<100;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch { /* Server is still starting. */ }await sleep(300);}
  assert.ok(ready,'static server is not available');
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
  const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block',acceptDownloads:true});
  const page=await context.newPage();
  page.setDefaultTimeout(35000);
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('https://api.github.com/repos/Noty-design/Parametric-designs/git/trees/**',r=>r.fulfill({
    status:200,contentType:'application/json',body:JSON.stringify({truncated:false,tree:[
      {path:'link/A_rotationsled_print_in_place.scad',type:'blob',size:128,sha:'fixture-link-a'},
      {path:'link/C_kulled_snappfaste.scad',type:'blob',size:128,sha:'fixture-link-c'},
    ]}),
  }));
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.documentElement.dataset.brepiaClientReady==='true',null,{timeout:60000});
  await page.getByRole('button',{name:'Open chain generator',exact:true}).click();
  const panel=page.getByTestId('chain-generator');
  await panel.waitFor({state:'visible'});
  await panel.getByLabel('Number of segments (1–150)').fill('4');
  await panel.getByRole('button',{name:'Open 3D preview in Viewer'}).click();
  await page.getByText('Source and parameters',{exact:true}).waitFor({timeout:50000});
  await page.getByTestId('off-component-inspector').waitFor({state:'visible',timeout:140000});
  await page.getByRole('button',{name:'Cancel preview'}).waitFor({state:'hidden',timeout:140000});
  await sleep(2000);
  const inspection=(await page.getByTestId('off-component-inspector').textContent())||'';
  console.log('CHAIN_INSPECTION',inspection.slice(0,500));
  const toggle=page.getByRole('button',{name:'Preview visual movement'});
  const mode=page.getByRole('combobox',{name:'Move mode'});
  for(let attempt=0;attempt<6;attempt++){
    if(await toggle.getAttribute('aria-pressed')!=='true') await toggle.click();
    await sleep(800);
    if(await mode.count() > 0 && await toggle.getAttribute('aria-pressed')==='true') break;
  }
  console.log('CHAIN_MOVE_ACTIVE',await toggle.getAttribute('aria-pressed'),'MODE_COUNT',await mode.count());
  console.log('CHAIN_MODE_OPTIONS',await mode.locator('option').allTextContents());
  const enabled=await mode.locator('option[value="part"]').isEnabled();
  if(!enabled)throw new Error('Real chain does not expose reliable distinct edge-connected parts');
  await mode.selectOption('part');
  const selector=page.getByRole('combobox',{name:'Select model part'});
  const count=await selector.locator('option').count()-1;
  console.log('CHAIN_MOVE_IDENTIFIED_PARTS',count);
  assert.ok(count>=2,'Expected at least two independent chain links, actual '+count);
  await selector.selectOption('0');
  await page.screenshot({path:path.join(evidence,'real-chain-part-selected.png'),fullPage:true});
  await selector.selectOption('1');
  await page.screenshot({path:path.join(evidence,'real-chain-second-part.png'),fullPage:true});
  await page.getByRole('button',{name:'Reset All Parts'}).click();
  assert.deepEqual(errors,[],'unexpected JS errors');
  await context.close();
  console.log('PART_MOVE_REAL_CHAIN_PASS');
} finally {if(browser)await browser.close();server.kill('SIGTERM');}
