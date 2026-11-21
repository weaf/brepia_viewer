import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { chromium } from "@playwright/test";

function readLidMove(code) {
  const match=/translate\(\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]\)\s+generate_lid\(\);/.exec(code);
  return match ? {snippet:match[0],delta:match.slice(1,4).map(Number)} : null;
}
const host = "http://127.0.0.1:4301/";
const desktop = process.env.SOURCE_MOVE_BROWSER_DEVICE === "desktop";
const evidence = path.resolve(".output/source-move-box-browser", desktop ? "desktop" : "mobile");
const file = process.env.SOURCE_MOVE_BOX_FILE;
assert.ok(file, "Real Box SCAD fixture path was not supplied");
const original = readFileSync(file, "utf8");
const source = original.replace(
  /^show_mounting_rails\s*=\s*true\s*;/m, "show_mounting_rails = false;",
);
assert.notEqual(source, original, "Expected to disable optional rails for two-part Box test");
await mkdir(evidence, { recursive: true });
const server = spawn("python3", [
  "-m", "http.server", "4301", "--bind", "127.0.0.1",
  "--directory", path.resolve(".output/public"),
], { stdio: "ignore" });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(host)).ok) { ready = true; break; } }
    catch { /* Try until static server is ready. */ }
    await pause(250);
  }
  assert.ok(ready, "Brepia static test server unavailable");
  browser = await chromium.launch({
    channel: "chrome", headless: true,
    args: ["--disable-dev-shm-usage", "--enable-unsafe-swiftshader"],
  });
  const context = await browser.newContext({
    viewport: desktop ? { width: 1365, height: 900 } : { width: 390, height: 844 },
    isMobile: !desktop, hasTouch: !desktop, serviceWorkers: "block", acceptDownloads: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(40000);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", msg => {
    if (msg.text().includes("[Source Move] SCAD verification rejected")) {
      void Promise.all(msg.args().map(arg => arg.jsonValue().catch(() => null)))
        .then(args => console.log("SOURCE_MOVE_BROWSER_VERIFICATION_DIAGNOSTICS", JSON.stringify(args)));
    }
  });
  const failedRequests = [];
  page.on("requestfailed", req => failedRequests.push({url:req.url().slice(0,180),error:req.failure()?.errorText}));
  const httpFailures = [];
  page.on("response", res => { if (res.status() >= 400) httpFailures.push({url:res.url().slice(0,180),status:res.status()}); });
  await context.route("https://api.github.com/repos/Noty-design/Parametric-designs/git/trees/**", route =>
    route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ truncated: false, tree: [] }),
    }),
  );
  try {
    await page.goto(host, { waitUntil: "domcontentloaded" });
    await page.screenshot({ path: path.join(evidence, "initial-page.jpg"), type: "jpeg", quality: 60 });
    try {
      await page.getByText("Model gallery", { exact: true }).first().waitFor({ timeout: 65000 });
      await page.waitForFunction(() =>
        document.documentElement.dataset.brepiaClientReady === "true",
        null, { timeout: 65000 });
    } catch (cause) {
      const snapshot = await page.evaluate(() => ({
        url:location.href,
        title:document.title,
        body:document.body.innerText.slice(0,1500),
        ready:document.readyState,
        clientReady:document.documentElement.dataset.brepiaClientReady,
        scripts:[...document.querySelectorAll("script")].map(x=>({src:x.src,type:x.type})).slice(0,12),
      })).catch(() => null);
      await page.screenshot({ path: path.join(evidence, "hydration-failure.jpg"), type: "jpeg", quality: 65 });
      console.error("SOURCE_MOVE_BOX_BROWSER_BOOT_DIAGNOSTICS", JSON.stringify({
        snapshot,errors,failedRequests:httpFailures.length?failedRequests.slice(-20):failedRequests.slice(-12),
        httpFailures:httpFailures.slice(-20),
      }));
      throw cause;
    }
    await page.locator('input[type="file"][accept=".scad,.scad.txt"]').setInputFiles({
      name: "source-move-real-box.scad", mimeType: "text/plain",
      buffer: Buffer.from(source),
    });
    await page.getByTestId("off-component-inspector").waitFor({
      state: "visible", timeout: 240000,
    });
    await page.getByRole("button", { name: "Cancel preview" }).waitFor({
      state: "hidden", timeout: 240000,
    });
    await page.getByRole("button", { name: "Experimental menu" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Enable source-aware Part Move" }).click();
    const panel = page.getByTestId("source-move-panel");
    await panel.waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Preview visual movement" }).click();
    await page.getByRole("combobox", { name: "Move mode" }).selectOption("part");
    const select = page.getByRole("combobox", { name: "Select model part" });
    assert.equal(await select.locator("option").count(), 3, "Expected box and lid only");
    await select.selectOption("1");
    if (!desktop) {
      await page.getByRole("button", { name: "Show precision slider" }).click();
      await page.getByRole("slider", { name: "Move model along X axis" }).fill("5");
    } else {
      // Desktop uses real pointer dragging instead of the mobile precision
      // slider. Pick the lid in the actual canvas, then drag along SCAD X.
      await page.getByRole("combobox",{name:"Visual move axis"}).selectOption("0");
      const canvas=page.locator("canvas").first();
      const bounds=await canvas.boundingBox();
      assert.ok(bounds&&bounds.width>250&&bounds.height>250,"Desktop 3D canvas missing");
      let hit=null;
      for(const fy of [0.5,0.4,0.6,0.3,0.7]){
        for(const fx of [0.25,0.35,0.45,0.55,0.65,0.75]){
          await select.selectOption("0");
          const x=bounds.x+bounds.width*fx,y=bounds.y+bounds.height*fy;
          await page.mouse.click(x,y);
          if((await select.inputValue())==="1"){hit={x,y};break;}
        }
        if(hit)break;
      }
      assert.ok(hit,"Desktop raycast could not select the real Box lid");
      await pause(650);
      await page.mouse.move(hit.x,hit.y);
      await page.mouse.down();
      await page.mouse.move(hit.x+95,hit.y-30,{steps:12});
      await page.mouse.up();
      await pause(400);
      const text=await panel.innerText();
      const matched=/Part 2: X (-?\d+(?:\.\d+)?)/.exec(text);
      assert.ok(matched&&Math.abs(Number(matched[1]))>=0.1,
        "Desktop drag did not move selected lid along X: "+text);
    }
    await page.screenshot({ path: path.join(evidence, "before-identification.jpg"), type: "jpeg", quality: 70 });
    await panel.getByRole("button", { name: "Identify source of selected part" }).click();
    await panel.getByText(/Matched part 2 to generate_lid/).waitFor({ timeout: 600000 });
    await page.screenshot({ path: path.join(evidence, "matched-lid.jpg"), type: "jpeg", quality: 70 });
    // Use the actual active model ID recorded by Viewer. Matching only a
    // filename can accidentally inspect an older imported copy.
    const readStoredSource = () => page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("brepia-local-models", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const tx = db.transaction(["cache", "models"], "readonly");
        const cache = await new Promise((resolve, reject) => {
          const req = tx.objectStore("cache").get("last-opened-local-model");
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const record = await new Promise((resolve, reject) => {
          const req = tx.objectStore("models").get(cache?.modelId);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        return record?.project?.files?.find(file =>
          file.path === record.project.entrypointPath)?.content ?? "";
      } finally { db.close(); }
    });
    const oldStored = await readStoredSource();
    assert.ok(oldStored.includes("generate_lid();"), "Uploaded Box source was not persisted");
    assert.ok(!readLidMove(oldStored),
      "The move was already saved before Apply");
    await panel.getByRole("button", { name: "Apply Part Move to OpenSCAD code" }).click();
    // A successful project save replaces the panel props and can clear its
    // success message. Observe the durable store as the actual success gate.
    // Stop promptly when the fail-closed geometry check rejects the move.
    let result = "timeout";
    for (let attempt = 0; attempt < 240; attempt += 1) {
      const actual = await readStoredSource();
      if (readLidMove(actual)) {
        result = "saved";
        break;
      }
      const status = await panel.innerText().catch(() => "");
      if (status.includes("Verification failed:") ||
          status.includes("Could not verify source change.")) {
        result = "rejected";
        break;
      }
      await pause(750);
    }
    if (result !== "saved") {
      await page.screenshot({path:path.join(evidence, "apply-not-saved.jpg"),type:"jpeg",quality:70});
      const message = await panel.innerText().catch(() => "");
      console.error("SOURCE_MOVE_BROWSER_REJECTION", JSON.stringify({result,message,errors}));
      throw new Error("Real Box Source Move was not saved: " + message);
    }
    await pause(1500); // Avoid treating a temporary transaction as a durable save.
    const saved = await readStoredSource();
    if (!readLidMove(saved)) {
      const snapshot = await page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
          const r = indexedDB.open("brepia-local-models", 1);
          r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
        });
        try {
          const tx = db.transaction(["cache", "models"], "readonly");
          const cache = await new Promise((resolve, reject) => {
            const r = tx.objectStore("cache").get("last-opened-local-model");
            r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
          });
          const rows = await new Promise((resolve, reject) => {
            const r = tx.objectStore("models").getAll();
            r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
          });
          return { cache,
            models: rows.map(row => ({
              id: row.id, name: row.name, active:row.id===cache?.modelId,
              entrypoint:row.project?.entrypointPath,
              files:row.project?.files?.map(f => ({
                path:f.path, chars:f.content.length,
                moved:/translate\\(\\[\\s*-?\\d+(?:\\.\\d+)?\\s*,\\s*-?\\d+(?:\\.\\d+)?\\s*,\\s*-?\\d+(?:\\.\\d+)?\\s*\\]\\)\\s+generate_lid\\(\\);/.test(f.content),
                lid:f.content.includes("generate_lid();"),
              })),
            })),
          };
        } finally { db.close(); }
      });
      console.error("SOURCE_MOVE_BOX_SAVE_DIAGNOSTICS", JSON.stringify({
        snapshot, panel:await panel.innerText().catch(()=>null),
        selectedSavedChars:saved.length, errors,
      }));
    }
    const savedMove=readLidMove(saved);
    assert.ok(savedMove, "IndexedDB source not changed");
    assert.ok(savedMove.delta.every(Number.isFinite),"Invalid moved SCAD coordinates");
    assert.ok(Math.abs(savedMove.delta[0])>=0.1 && Math.abs(savedMove.delta[1])<0.001 && Math.abs(savedMove.delta[2])<0.001,
      "Source Move modified an unexpected axis: "+JSON.stringify(savedMove.delta));
    if(!desktop)assert.equal(savedMove.delta[0],5,"Mobile 5 mm move drifted");
    assert.ok(saved.includes("generate_box();"), "Unrelated box source missing from saved file");
    await page.screenshot({ path: path.join(evidence, "code-after-apply.jpg"), type: "jpeg", quality: 70 });
    await page.reload({ waitUntil: "domcontentloaded" });
    const openSaved = page.getByRole("button", { name: "Open source-move-real-box", exact: true });
    await openSaved.waitFor({ timeout: 60000 });
    await openSaved.click();
    await page.getByText("Source and parameters", { exact: true }).waitFor({ timeout: 60000 });
    const persisted = await readStoredSource();
    assert.ok(persisted.includes(savedMove.snippet),
      "Saved SCAD change disappeared after reload");
    await page.screenshot({ path: path.join(evidence, "persisted-after-reload.jpg"), type: "jpeg", quality: 70 });

    // A real exported SCAD, not just IndexedDB, must retain the code change.
    await page.getByTestId("off-component-inspector").waitFor({state:"visible",timeout:240000});
    await page.getByRole("button",{name:"Cancel preview"}).waitFor({state:"hidden",timeout:240000});
    const exportButton=page.getByRole("button",{name:"Export model"});
    await exportButton.waitFor({state:"visible"});
    assert.ok(await exportButton.isEnabled(),"SCAD export unavailable after reload");
    await exportButton.click();
    const [download]=await Promise.all([
      page.waitForEvent("download",{timeout:60000}),
      page.getByRole("menuitem",{name:/\.SCAD/}).click(),
    ]);
    const downloadedPath=await download.path();
    assert.ok(downloadedPath,"SCAD export has no readable download path");
    const exportedCode=readFileSync(downloadedPath,"utf8");
    assert.ok(exportedCode.includes(savedMove.snippet),
      "Exported SCAD did not retain the moved lid");
    assert.ok(exportedCode.includes("generate_box();"),
      "Exported SCAD lost the unchanged box");
    console.log("SOURCE_MOVE_BOX_SCAD_EXPORT_PASS",JSON.stringify({
      device:desktop?"desktop":"mobile",name:download.suggestedFilename(),
      codeChars:exportedCode.length,retainedTranslation:true,
    }));

    assert.deepEqual(errors, [], "Unexpected browser JavaScript exceptions");
    console.log("SOURCE_MOVE_REAL_BOX_BROWSER_SAVE_PASS " + JSON.stringify({
      device: desktop ? "Chrome desktop 1365x900" : "Chrome mobile 390x844",
      selectedPart: 2,
      module: "generate_lid",
      delta: [5,0,0],
      savedAfterReload: true,
      evidence,
    }));
  } finally { await context.close(); }
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
