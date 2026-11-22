import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { chromium } from "@playwright/test";

const host = "http://127.0.0.1:4303/";
const evidence = path.resolve(".output/source-move-chain-browser/mobile");
const fixture = process.env.SOURCE_MOVE_CHAIN_FILE;
assert.ok(fixture, "Real generated chain SCAD fixture is required");
const source = readFileSync(fixture, "utf8");
assert.ok(source.includes("chain_link(i);") && source.includes("chain_count=3;"));
const savedMove = code => {
  const match = /translate\(\s*i\s*==\s*1\s*\?\s*\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]\s*:\s*\[\s*0\s*,\s*0\s*,\s*0\s*\]\s*\)\s*chain_link\(i\);/.exec(code);
  return match ? { snippet: match[0], delta: match.slice(1, 4).map(Number) } : null;
};
await mkdir(evidence, { recursive: true });
const server = spawn("python3", [
  "-m", "http.server", "4303", "--bind", "127.0.0.1", "--directory", path.resolve(".output/public"),
], { stdio: "ignore" });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(host)).ok) { ready = true; break; } }
    catch { /* bounded startup wait */ }
    await pause(250);
  }
  assert.ok(ready, "Viewer static server did not start");
  browser = await chromium.launch({
    channel: "chrome", headless: true,
    args: ["--disable-dev-shm-usage", "--enable-unsafe-swiftshader"],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true, serviceWorkers: "block", acceptDownloads: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(40000);
  const errors = [];
  page.on("pageerror", err => errors.push(err.message));
  page.on("console", msg => {
    if (msg.text().includes("[Source Move] independent proof rejected") ||
        msg.text().includes("[Source Move] located shell diagnostic") ||
        msg.text().includes("[Source Move] SCAD verification rejected")) {
      void Promise.all(msg.args().map(arg => arg.jsonValue().catch(() => null)))
        .then(args => console.log("CHAIN_SOURCE_MOVE_DIAGNOSTICS", JSON.stringify(args)));
    }
  });
  await context.route("https://api.github.com/repos/Noty-design/Parametric-designs/git/trees/**", route =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ truncated: false, tree: [] }) }),
  );
  const readStored = () => page.evaluate(async () => {
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
      const model = await new Promise((resolve, reject) => {
        const r = tx.objectStore("models").get(cache?.modelId);
        r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
      });
      return model?.project?.files?.find(f => f.path === model.project.entrypointPath)?.content ?? "";
    } finally { db.close(); }
  });
  try {
    await page.goto(host, { waitUntil: "domcontentloaded" });
    await page.getByText("Model gallery", { exact: true }).first().waitFor({ timeout: 65000 });
    await page.waitForFunction(() =>
      document.documentElement.dataset.brepiaClientReady === "true",
      null, { timeout: 65000 });
    await page.locator('input[type="file"][accept=".scad,.scad.txt"]').setInputFiles({
      name: "source-move-real-chain.scad", mimeType: "text/plain", buffer: Buffer.from(source),
    });
    await page.getByTestId("off-component-inspector").waitFor({ state: "visible", timeout: 300000 });
    await page.getByRole("button", { name: "Cancel preview" }).waitFor({ state: "hidden", timeout: 300000 });
    await page.screenshot({ path: path.join(evidence, "chain-loaded.jpg"), type: "jpeg", quality: 65 });
    await page.getByRole("button", { name: "Experimental menu" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Enable source-aware Part Move" }).click();
    const panel = page.getByTestId("source-move-panel");
    await panel.waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Preview visual movement" }).click();
    await page.getByRole("combobox", { name: "Move mode" }).selectOption("part");
    const select = page.getByRole("combobox", { name: "Select model part" });
    assert.equal(await select.locator("option").count(), 4, "Expected three independent chain links");
    await select.selectOption("1");
    await page.getByRole("button", { name: "Show precision slider" }).click();
    await page.getByRole("slider", { name: "Move model along X axis" }).fill("5");
    await page.screenshot({ path: path.join(evidence, "second-link-selected.jpg"), type: "jpeg", quality: 65 });
    await panel.getByRole("button", { name: "Identify source of selected part" }).click();
    await panel.getByText(/Matched part 2 to chain_link/).waitFor({ timeout: 600000 });
    await page.screenshot({ path: path.join(evidence, "source-matched.jpg"), type: "jpeg", quality: 65 });
    const originalStored = await readStored();
    assert.ok(originalStored.includes("for(i=[0:chain_count-1])"), "Chain source was not imported");
    assert.ok(!savedMove(originalStored), "Source was already moved");
    await panel.getByRole("button", { name: "Apply Part Move to OpenSCAD code" }).click();
    let outcome = "timeout";
    for (let attempt = 0; attempt < 480; attempt += 1) {
      const stored = await readStored();
      if (savedMove(stored)) { outcome = "saved"; break; }
      const status = await panel.innerText().catch(() => "");
      if (/Verification failed:|Nothing saved\.|Could not verify source change\./.test(status)) {
        outcome = "rejected";
        break;
      }
      await pause(1000);
    }
    if (outcome !== "saved") {
      const message = await panel.innerText().catch(() => "");
      await page.screenshot({ path: path.join(evidence, "source-not-saved.jpg"), type: "jpeg", quality: 65 });
      console.error("CHAIN_BROWSER_SOURCE_MOVE_REJECTED", JSON.stringify({ outcome, message, errors }));
      throw Error("Real chain failed to persist Source Move: " + message);
    }
    await pause(1500);
    const updated = await readStored();
    const move = savedMove(updated);
    assert.ok(move, "IndexedDB lost new source");
    assert.deepEqual(move.delta, [5, 0, 0], "Wrong axis or delta");
    assert.equal(updated.replace(move.snippet, "chain_link(i);"), source,
      "Unexpected source mutation beyond the selected link translation");
    await page.screenshot({ path: path.join(evidence, "source-saved.jpg"), type: "jpeg", quality: 65 });
    await page.reload({ waitUntil: "domcontentloaded" });
    const openSaved = page.getByRole("button", { name: "Open source-move-real-chain", exact: true });
    await openSaved.waitFor({ timeout: 60000 });
    await openSaved.click();
    await page.getByText("Source and parameters", { exact: true }).waitFor({ timeout: 60000 });
    assert.ok((await readStored()).includes(move.snippet), "Saved move disappeared after reload");
    await page.screenshot({ path: path.join(evidence, "source-after-reload.jpg"), type: "jpeg", quality: 65 });
    await page.getByTestId("off-component-inspector").waitFor({ state: "visible", timeout: 300000 });
    await page.getByRole("button", { name: "Cancel preview" }).waitFor({ state: "hidden", timeout: 300000 });
    const exportButton = page.getByRole("button", { name: "Export model" });
    await exportButton.click();
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 60000 }),
      page.getByRole("menuitem", { name: /\.SCAD/ }).click(),
    ]);
    const file = await download.path();
    assert.ok(file, "SCAD export missing");
    const exported = readFileSync(file, "utf8");
    assert.ok(exported.includes(move.snippet), "SCAD export dropped indexed translation");
    assert.equal(exported.replace(move.snippet, "chain_link(i);"), source,
      "Export changed other chain code unexpectedly");
    assert.deepEqual(errors, [], "Unexpected browser JavaScript exception");
    console.log("SOURCE_MOVE_REAL_CHAIN_BROWSER_SAVE_PASS", JSON.stringify({
      viewport: "390x844", selectedIndex: 1, sourceModule: "chain_link",
      delta: move.delta, persisted: true, exported: true, sourceBytes: exported.length, evidence,
    }));
  } finally { await context.close(); }
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
