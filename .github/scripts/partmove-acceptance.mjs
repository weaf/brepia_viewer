import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {chromium} from '@playwright/test';
const origin='http://127.0.0.1:4199/';
const proof=path.resolve('.output/partmove-acceptance');
await mkdir(proof,{recursive:true});
const server=spawn('python3',['-m','http.server','4199','--bind','127.0.0.1','--directory',path.resolve('.output/public')],{stdio:'ignore'});
let browser;
try {
  let ready=false;
  for(let i=0;i<90;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch { /* Server is still starting. */ }await pause(300);}
  assert.ok(ready,'static browser server did not start');
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
  for(const device of [{name:'desktop',width:1440,height:900,mobile:false},{name:'mobile',width:390,height:844,mobile:true}]){
    const context=await browser.newContext({viewport:{width:device.width,height:device.height},isMobile:device.mobile,hasTouch:device.mobile,serviceWorkers:'block'});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    try {
      await context.route('https://api.github.com/repos/Noty-design/Parametric-designs/git/trees/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({truncated:false,tree:[]})}));
      await page.goto(origin,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>document.documentElement.dataset.brepiaClientReady==='true',null,{timeout:65000});
      const scad='translate([-20,0,0]) cube([10,10,10]);\ntranslate([20,0,0]) cube([10,10,10]);\n';
      await page.locator('input[type="file"][accept=".scad,.scad.txt"]').setInputFiles({name:'partmove-two-boxes.scad',mimeType:'text/plain',buffer:Buffer.from(scad)});
      await page.getByTestId('off-component-inspector').waitFor({state:'visible',timeout:120000});
      await page.getByRole('button',{name:'Cancel preview'}).waitFor({state:'hidden',timeout:120000});
      await pause(2000); // allow Stage first-camera fit before toggling Move
      const toggle=page.getByRole('button',{name:'Preview visual movement'});
      await toggle.waitFor({state:'visible'});
      if(await toggle.getAttribute('aria-pressed')!=='true')await toggle.click();
      await page.locator('canvas').first().screenshot({path:path.join(proof,device.name+'-whole-camera.png')});
      await page.getByRole('combobox',{name:'Move mode'}).selectOption('part');
      if (device.mobile) {
        const canvasBefore = await page.locator('canvas').first().boundingBox();
        const expand = page.getByRole('button', {name:'Expand 3D viewer'});
        await expand.click();
        const canvasExpanded = await page.locator('canvas').first().boundingBox();
        assert.ok(canvasBefore && canvasExpanded && canvasExpanded.height > canvasBefore.height + 140,
          'Mobile expanded viewer did not increase visible 3D height');
        for (const label of ['Y','Z','X']) {
          await page.getByRole('button', {name:'Move along ' + label + ' axis'}).click();
        }
        assert.equal(await page.getByRole('button', {name:'Move along X axis'}).getAttribute('aria-pressed'), 'true');
        await page.getByRole('button',{name:'Exit expanded viewer'}).click();
        const axisButtons = await page.getByRole('group', {name:'Move axis'}).boundingBox();
        const mobileControls = await page.getByTestId('visual-move-mobile-controls').boundingBox();
        assert.ok(axisButtons && axisButtons.width > axisButtons.height * 2,
          'Mobile X/Y/Z axis buttons must be arranged horizontally, not as a tall overlay');
        assert.ok(mobileControls && axisButtons.y + axisButtons.height < mobileControls.y,
          'Mobile axis buttons must not cover part-selection controls');
        await page.screenshot({path:path.join(proof,device.name+'-axis-layout.png'),fullPage:true});
      }
      await page.locator('canvas').first().screenshot({path:path.join(proof,device.name+'-part-camera.png')});
      const controls=page.getByTestId('part-move-controls');
      await controls.waitFor({state:'visible'});
      const selector=controls.getByRole('combobox',{name:'Select model part'});
      assert.equal(await selector.locator('option').count(),3,device.name+': should identify 2 components');
      await selector.selectOption('0');
      // Verify true 3D raycast selection, not only selecting through the fallback menu.
      const hitCanvas=page.locator('canvas').first();
      await hitCanvas.waitFor({state:'visible',timeout:15000});
      const hitBox=await hitCanvas.boundingBox();
      assert.ok(hitBox,'No 3D canvas for direct component picking');
      await hitCanvas.screenshot({path:path.join(proof,device.name+'-before-direct-click.png')});
      console.log('HIT_CANVAS_BOUNDS',JSON.stringify(hitBox));
      let directlyPicked=false;
      let selectedScreenPoint=null;
      for(const fy of [0.4,0.5,0.6,0.3,0.7]){
        for(const fx of [0.25,0.35,0.45,0.55,0.65,0.75]){
          const x=hitBox.x+hitBox.width*fx,y=hitBox.y+hitBox.height*fy;
          if(device.mobile)await page.touchscreen.tap(x,y);
          else await page.mouse.click(x,y);
          if((await selector.inputValue())==='1'){directlyPicked=true;selectedScreenPoint={x,y};break;}
        }
        if(directlyPicked)break;
      }
      assert.ok(directlyPicked,device.name+': direct 3D raycast selection failed');
      console.log('PART_MOVE_DIRECT_RAYCAST_'+device.name.toUpperCase()+'_PASS');
      await pause(650); // allow selected-part R3F geometry and gizmo to mount
      assert.ok(selectedScreenPoint,'Cannot start drag without selected hit point');
      if(device.mobile){
        const cdp=await context.newCDPSession(page);
        const emit=(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{
          type,touchPoints:type==='touchEnd'?[]:[{x,y,id:88}],
        });
        await emit('touchStart',selectedScreenPoint.x,selectedScreenPoint.y);
        for(let step=1;step<=10;step++) {
          await emit('touchMove',selectedScreenPoint.x+step*7,selectedScreenPoint.y-step*3);
          await pause(50);
        }
        await emit('touchEnd',selectedScreenPoint.x+70,selectedScreenPoint.y-30);
      } else {
        await page.mouse.move(selectedScreenPoint.x,selectedScreenPoint.y);
        await page.mouse.down();
        await page.mouse.move(selectedScreenPoint.x+95,selectedScreenPoint.y-40,{steps:12});
        await page.mouse.up();
      }
      await pause(200);
      const moved=(await page.getByTestId('visual-move-offsets').first().textContent())||'';
      assert.ok(!moved.includes('Scene X 0.0 / Y 0.0 / Z 0.0'),
        device.name+': selected part did not move from true mouse/touch drag: '+moved);
      console.log('PART_MOVE_CONTINUOUS_DRAG_'+device.name.toUpperCase()+'_PASS',moved);
      if (device.mobile) {
        const translatedX=Number(/Scene X (-?\d+(?:\.\d+)?)/.exec(moved)?.[1]);
        assert.ok(Number.isFinite(translatedX) && translatedX > 0.5 && translatedX < 12,
          'individual part mobile drag must be precise enough to stay visible: '+moved);
        console.log('PART_MOVE_MOBILE_FINE_TOUCH_GAIN_PASS',translatedX);
      }
      // Even when a moved part leaves the canvas, cycling remains a recovery
      // mechanism. Preserve the precise visual offset across part changes.
      // Verify large-offset recovery with the part buttons, then use a small
      // *visible* offset for the separate direct-3D repick acceptance.
      const largeDraggedOffset=moved;
      // Previously a moved gizmo could swallow the next tap and make a
      // previously selected component difficult or impossible to reselect.
      // Cycle between the same two real meshes WITHOUT resetting offsets.
      const prevPart=page.getByRole('button',{name:'Previous model part'});
      const nextPart=page.getByRole('button',{name:'Next model part'});
      await nextPart.click();
      assert.equal(await selector.inputValue(),'0',device.name+': next must wrap to part 1');
      assert.match((await page.getByTestId('visual-move-offsets').first().textContent())||'',/Scene X 0\.0 \/ Y 0\.0 \/ Z 0\.0/,
        device.name+': untouched part offset changed');
      await prevPart.click();
      assert.equal(await selector.inputValue(),'1',device.name+': previous must return to moved part');
      assert.equal(await page.getByTestId('visual-move-offsets').first().textContent(),largeDraggedOffset,
        device.name+': moving away and back must retain the original offset');
      if (device.mobile) {
        // Deliberately bring the moved part back into the actual 3D viewport.
        // This only changes preview offset; the real large-drag test above
        // already passed and must not be weakened.
        const precision=page.getByTestId('visual-move-mobile-controls');
        await precision.getByRole('button',{name:'Show precision slider'}).click();
        await precision.getByRole('slider',{name:'Move model along X axis'}).fill('2');
        await precision.getByRole('button',{name:'Hide precision slider'}).click();
        assert.match((await page.getByTestId('visual-move-offsets').first().textContent())||'',/X 2\.0/,
          'mobile: small visibility-safe offset must be preserved');
      }
      await prevPart.click();
      assert.equal(await selector.inputValue(),'0');
      // Selecting a moved part from the 3D canvas (not just the fallback
      // selector) must remain possible after switching to another part.
      await hitCanvas.screenshot({path:path.join(proof,device.name+'-moved-part-before-repick.png')});
      const repickBounds=await hitCanvas.boundingBox();
      assert.ok(repickBounds,'3D canvas vanished after moving the part');
      // The selected box starts at the far right of the test viewport.
      // Moving +X shifts it farther right. The old grid capped at 75%
      // width and never hit the displaced geometry, a test defect.
      let repicked=false;
      for(const fy of [0.3,0.4,0.5,0.2,0.6,0.7,0.8]){
        for(const fx of [0.9,0.95,0.85,0.8,0.75,0.7,0.65,0.55,0.45,0.35,0.25]){
          const x=repickBounds.x+repickBounds.width*fx;
          const y=repickBounds.y+repickBounds.height*fy;
          if(device.mobile)await page.touchscreen.tap(x,y);
          else await page.mouse.click(x,y);
          if((await selector.inputValue())==='1'){repicked=true;break;}
        }
        if(repicked)break;
      }
      if(!repicked) {
        await page.screenshot({path:path.join(proof,device.name+'-repick-failed.png'),fullPage:true});
      }
      assert.ok(repicked,device.name+': reselecting moved part by clicking in 3D failed');
      console.log('PART_MOVE_RESELECTION_'+device.name.toUpperCase()+'_PASS',moved);
      await page.getByRole('button',{name:'Reset Selected Part'}).click();
      await selector.selectOption('0');
      await page.screenshot({path:path.join(proof,device.name+'-selected-part.png'),fullPage:true});
      const offsets=page.getByTestId('visual-move-offsets').first();
      assert.match(await offsets.textContent(),/X 0\.0 \/ Y 0\.0 \/ Z 0\.0/);
      if(device.mobile){
        const precision=page.getByTestId('visual-move-mobile-controls');
        await precision.getByRole('button',{name:'Show precision slider'}).click();
        const slider=precision.getByRole('slider',{name:'Move model along X axis'});
        await slider.fill('15');
        assert.match(await offsets.textContent(),/X 15\.0/);
      } else {
        const canvas=page.locator('canvas').first();
        await canvas.waitFor({state:'visible',timeout:15000});
        const b=await canvas.boundingBox();
        assert.ok(b&&b.width>200&&b.height>200);
      }
      await selector.selectOption('1');
      assert.match(await offsets.textContent(),/X 0\.0 \/ Y 0\.0 \/ Z 0\.0/,'second part should keep independent transform');
      await selector.selectOption('0');
      if(device.mobile) assert.match(await offsets.textContent(),/X 15\.0/,'first part transform must persist');
      await page.getByRole('button',{name:'Reset Selected Part'}).click();
      assert.match(await offsets.textContent(),/X 0\.0/);
      await controls.getByRole('button',{name:'Reset All Parts'}).click();
      await page.screenshot({path:path.join(proof,device.name+'-reset.png'),fullPage:true});
      await page.getByRole('combobox',{name:'Move mode'}).selectOption('whole');
      assert.equal(await toggle.getAttribute('aria-pressed'),'true');
      assert.deepEqual(errors,[],'page JS errors');
      console.log('PART_MOVE_BROWSER_'+device.name.toUpperCase()+'_PASS');
    } finally {await context.close();}
  }
}finally{if(browser)await browser.close();server.kill('SIGTERM');}
