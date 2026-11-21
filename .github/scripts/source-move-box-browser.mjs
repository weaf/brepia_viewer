import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { chromium } from "@playwright/test";

const host = "http://127.0.0.1:4301/";
const evidence = path.resolve(".output/source-move-box-browser");
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
    viewport: { width: 390, height: 844 }, isMobile: true,
    hasTouch: true, serviceWorkers: "block",
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
    await page.getByRole("button", { name: "Show precision slider" }).click();
    await page.getByRole("slider", { name: "Move model along X axis" }).fill("5");
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
    assert.ok(!oldStored.includes("translate([5, 0, 0]) generate_lid();"),
      "The move was already saved before Apply");
    await panel.getByRole("button", { name: "Apply Part Move to OpenSCAD code" }).click();
    await panel.getByText(/Verification failed:|SCAD updated and verified\./).waitFor({timeout:180000});
    const verificationMessage = await panel.innerText();
    if (verificationMessage.includes("Verification failed:")) {
      await page.screenshot({path:path.join(evidence, "verification-rejected.jpg"),type:"jpeg",quality:70});
      console.error("SOURCE_MOVE_BROWSER_REJECTION", verificationMessage);
      throw new Error("Viewer rejected Box move before persistence: " + verificationMessage);
    }
    try {
      await page.waitForFunction(async () => {
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
          const model = await new Promise((resolve, reject) => {
            const req = tx.objectStore("models").get(cache?.modelId);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          return model?.project?.files?.some(f =>
            f.content.includes("translate([5, 0, 0]) generate_lid();"));
        } finally { db.close(); }
      }, null, {timeout:360000, polling:1200});
    } catch (error) {
      await page.screenshot({ path: path.join(evidence, "apply-not-saved.jpg"), type: "jpeg", quality: 70 });
      console.error("SOURCE_MOVE_BOX_APPLY_DIAGNOSTICS", JSON.stringify({
        panel:await panel.innerText().catch(()=>null),
        currentSourceHasTranslation:(await readStoredSource()).includes("translate([5, 0, 0]) generate_lid();"),
        errors,
      }));
      throw error;
    }
    const saved = await readStoredSource();
    if (!saved.includes("translate([5, 0, 0]) generate_lid();")) {
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
                moved:f.content.includes("translate([5, 0, 0]) generate_lid();"),
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
    assert.ok(saved.includes("translate([5, 0, 0]) generate_lid();"), "IndexedDB source not changed");
    assert.ok(saved.includes("generate_box();"), "Unrelated box source missing from saved file");
    await page.screenshot({ path: path.join(evidence, "code-after-apply.jpg"), type: "jpeg", quality: 70 });
    await page.reload({ waitUntil: "domcontentloaded" });
    const openSaved = page.getByRole("button", { name: "Open source-move-real-box", exact: true });
    await openSaved.waitFor({ timeout: 60000 });
    await openSaved.click();
    await page.getByText("Source and parameters", { exact: true }).waitFor({ timeout: 60000 });
    const persisted = await readStoredSource();
    assert.ok(persisted.includes("translate([5, 0, 0]) generate_lid();"),
      "Saved SCAD change disappeared after reload");
    await page.screenshot({ path: path.join(evidence, "persisted-after-reload.jpg"), type: "jpeg", quality: 70 });
    assert.deepEqual(errors, [], "Unexpected browser JavaScript exceptions");
    console.log("SOURCE_MOVE_REAL_BOX_BROWSER_SAVE_PASS " + JSON.stringify({
      device: "Chrome mobile 390x844",
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
