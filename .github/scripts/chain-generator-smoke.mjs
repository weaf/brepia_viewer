import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "@playwright/test";

const origin = "http://127.0.0.1:4192/";
const output = process.env.RUNNER_TEMP
  ? path.join(process.env.RUNNER_TEMP, "viewer-static-evidence")
  : path.resolve(".output/static-evidence");
await mkdir(output, { recursive: true });
const server = spawn("python3", ["-m","http.server","4192","--bind","127.0.0.1","--directory",path.resolve(".output/public")], {
  stdio: ["ignore","pipe","pipe"],
});
let serverError = "";
server.stderr.on("data", data => { serverError += data.toString(); });
let browser;
const failures = [];
try {
  let available = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(origin)).ok) { available = true; break; } } catch {}
    await sleep(250);
  }
  if (!available) throw new Error("HTTP server unavailable: " + serverError);
  browser = await chromium.launch({channel:"chrome",headless:true,args:["--disable-dev-shm-usage","--enable-unsafe-swiftshader"]});
  for (const device of [{name:"desktop",width:1440,height:900,mobile:false},{name:"mobile",width:390,height:844,mobile:true}]) {
    const context = await browser.newContext({
      viewport:{width:device.width,height:device.height},
      isMobile:device.mobile,hasTouch:device.mobile,
      acceptDownloads:true,serviceWorkers:"block",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(25000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.goto(origin,{waitUntil:"domcontentloaded"});
      await page.getByText("Model gallery",{exact:true}).waitFor({timeout:35000});
      const openExperimental = async () => page.getByRole("button",{name:"Experimental menu"}).click();
      await openExperimental();
      const enable = page.getByRole("menuitemcheckbox",{name:"Enable Experimental mode"});
      if ((await enable.getAttribute("aria-checked")) !== "true") await enable.click();
      await openExperimental();
      await page.getByRole("menuitemcheckbox",{name:"Open parametric chain generator"}).click();
      const panel = page.getByTestId("chain-generator");
      await panel.waitFor({state:"visible"});
      await panel.getByLabel("Number of segments (1–150)").fill("25");
      await panel.getByRole("group",{name:"Choose segment"}).getByRole("button",{name:"7",exact:true}).click();
      await panel.getByLabel("Body Shape").selectOption("Sphere");
      await panel.getByLabel("Decoration",{exact:true}).selectOption("Letter");
      await panel.getByLabel("Letter").selectOption("Å");
      await panel.getByRole("group",{name:"Choose segment"}).getByRole("button",{name:"12",exact:true}).click();
      await panel.getByLabel("Body Shape").selectOption("Pyramid");
      await panel.getByLabel("Decoration",{exact:true}).selectOption("Octopus Head");
      await panel.getByLabel("Joint Fit").selectOption("Very Loose");
      await page.screenshot({path:path.join(output,device.name+"-chain-editor.png"),fullPage:true});
      const [jsonDownload] = await Promise.all([
        page.waitForEvent("download"),
        panel.getByRole("button",{name:"Save JSON"}).click(),
      ]);
      const config = JSON.parse(await readFile(await jsonDownload.path(),"utf8"));
      assert.equal(config.schema,"brepia-chain/v1");
      assert.equal(config.count,25);
      assert.equal(config.overrides["6"].shape,"Sphere");
      assert.equal(config.overrides["6"].letter,"Å");
      assert.equal(config.overrides["11"].decoration,"Octopus Head");
      assert.equal(config.overrides["11"].fit,"Very Loose");
      const [scadDownload] = await Promise.all([
        page.waitForEvent("download"),
        panel.getByRole("button",{name:"Export SCAD"}).click(),
      ]);
      const scad = await readFile(await scadDownload.path(),"utf8");
      assert.ok(scad.includes("chain_count=25;"));
      assert.ok(scad.includes("module chain_octopus_head()"));
      assert.ok(!scad.includes("include <"));
      await panel.getByLabel("Number of segments (1–150)").fill("1");
      await panel.locator('input[aria-label="Open chain JSON"]').setInputFiles({
        name:"roundtrip-chain.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(config)),
      });
      await panel.getByLabel("Number of segments (1–150)").waitFor();
      assert.equal(await panel.getByLabel("Number of segments (1–150)").inputValue(),"25");
      await panel.getByLabel("Layout").selectOption("single");
      await panel.getByRole("button",{name:"Open 3D preview in Viewer"}).click();
      await page.getByText("Source and parameters",{exact:true}).waitFor({timeout:45000});
      await page.screenshot({path:path.join(output,device.name+"-chain-preview.png"),fullPage:true});
      await openExperimental();
      await page.getByRole("menuitemcheckbox",{name:"Open parametric chain generator"}).click();
      await panel.waitFor({state:"visible"});
      assert.equal(await panel.getByLabel("Number of segments (1–150)").inputValue(),"25","Chain should survive Viewer preview");
      assert.equal(await panel.getByRole("group",{name:"Choose segment"}).getByRole("button",{name:"12",exact:true}).count(),1);
      await page.screenshot({path:path.join(output,device.name+"-chain-return.png"),fullPage:true});

      assert.deepEqual(errors,[],"Client errors: "+errors.join("; "));
      console.log("["+device.name+"] chain JSON/SCAD and Viewer preview passed");
    } catch (error) {
      failures.push(device.name+": "+(error.stack||error.message));
      await page.screenshot({path:path.join(output,device.name+"-chain-failure.png"),fullPage:true}).catch(()=>{});
    } finally {
      await context.close();
    }
  }
} finally {
  if(browser) await browser.close();
  server.kill("SIGTERM");
}
if(failures.length) {console.error(failures.join("\n\n"));process.exitCode=1;}
