import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { chromium } from "@playwright/test";

const host="http://127.0.0.1:4301/";
const evidence=path.resolve(".output/source-move-acceptance");
await mkdir(evidence,{recursive:true});
const server=spawn("python3",["-m","http.server","4301","--bind","127.0.0.1","--directory",path.resolve(".output/public")],{stdio:"ignore"});
let browser;
try {
  let ready=false;
  for(let i=0;i<70;i++){
    try{if((await fetch(host)).ok){ready=true;break;}}catch{ /* Static server not ready yet. */ }
    await pause(250);
  }
  assert.ok(ready,"Source Move static test server is unavailable");
  browser=await chromium.launch({channel:"chrome",headless:true,args:["--disable-dev-shm-usage","--enable-unsafe-swiftshader"]});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:"block"});
  const page=await context.newPage();
  const errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  await context.route("https://api.github.com/repos/Noty-design/Parametric-designs/git/trees/**",route=>
    route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({truncated:false,tree:[]})}));
  try{
    await page.goto(host,{waitUntil:"domcontentloaded"});
    await page.waitForFunction(()=>document.documentElement.dataset.brepiaClientReady==="true",null,{timeout:65000});
    const source=[
      "module left_part() { cube([10,10,10]); }",
      "module right_part() { cube([10,10,10]); }",
      "translate([-35,0,0]) left_part();",
      "translate([35,0,0]) right_part();",
    ].join("\n")+"\n";
    await page.locator('input[type="file"][accept=".scad,.scad.txt"]').setInputFiles({
      name:"source-move-acceptance.scad",mimeType:"text/plain",buffer:Buffer.from(source),
    });
    await page.getByTestId("off-component-inspector").waitFor({state:"visible",timeout:110000});
    await page.getByRole("button",{name:"Cancel preview"}).waitFor({state:"hidden",timeout:110000});
    await page.getByRole("button",{name:"Experimental menu"}).click();
    await page.getByRole("menuitemcheckbox",{name:"Enable source-aware Part Move"}).click();
    const panel=page.getByTestId("source-move-panel");
    await panel.waitFor({state:"visible"});
    await page.getByRole("button",{name:"Preview visual movement"}).click();
    await page.getByRole("combobox",{name:"Move mode"}).selectOption("part");
    const selector=page.getByRole("combobox",{name:"Select model part"});
    assert.equal(await selector.locator("option").count(),3);
    await selector.selectOption("1");
    await page.getByRole("button",{name:"Show precision slider"}).click();
    await page.getByRole("slider",{name:"Move model along X axis"}).fill("5");
    await page.getByTestId("visual-move-offsets").getByText(/X 5\.0/).waitFor({timeout:12000}).catch(async()=>{
      const text=await page.getByTestId("visual-move-offsets").innerText();
      assert.ok(text.includes("X 5.0"),text);
    });
    await page.screenshot({path:path.join(evidence,"before-source-identification.jpg"),type:"jpeg",quality:60});
    await panel.getByRole("button",{name:"Identify source of selected part"}).click();
    await panel.getByText(/Matched part 2 to right_part/).waitFor({timeout:180000});
    console.log("SOURCE_MOVE_PROVENANCE_UI_PASS "+(await panel.innerText()).slice(0,400));
    await page.screenshot({path:path.join(evidence,"source-matched.jpg"),type:"jpeg",quality:60});
    await panel.getByRole("button",{name:"Apply Part Move to OpenSCAD code"}).click();
    await page.getByRole("button",{name:"Cancel preview"}).waitFor({state:"hidden",timeout:160000});
    await pause(1500);
    const editorOpen=page.getByRole("button",{name:"Open source-move-acceptance.scad"});
    await editorOpen.waitFor({state:"visible",timeout:20000});
    await editorOpen.click();
    const content=await page.locator(".cm-content").first().innerText();
    assert.ok(content.includes("translate([5, 0, 0]) right_part();"),"SCAD file not changed correctly: "+content.slice(-600));
    assert.ok(content.includes("translate([-35,0,0]) left_part();"),"Unrelated part source was altered");
    await page.screenshot({path:path.join(evidence,"applied-source.jpg"),type:"jpeg",quality:60});
    assert.deepEqual(errors,[],"browser JS errors");
    console.log("SOURCE_MOVE_FULL_CHAIN_APPLY_PASS "+JSON.stringify({viewport:"390x844",sourceUpdated:true,unchangedLeft:true,evidence}));
  }finally{await context.close();}
}finally{await browser?.close();server.kill("SIGTERM");}
