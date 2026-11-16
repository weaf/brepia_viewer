import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { chromium } from "@playwright/test";

const origin = "http://127.0.0.1:4195/";
const evidence = process.env.RUNNER_TEMP
  ? path.join(process.env.RUNNER_TEMP, "move-drag-evidence")
  : path.resolve(".output/move-drag-evidence");
await mkdir(evidence, { recursive: true });
const server = spawn("python3", ["-m", "http.server", "4195", "--bind", "127.0.0.1",
  "--directory", path.resolve(".output/public")], { stdio: "ignore" });
let browser;
try {
  for (let attempt = 0; attempt < 80; attempt++) {
    try { if ((await fetch(origin)).ok) break; } catch { /* startup */ }
    await pause(250);
  }
  browser = await chromium.launch({
    channel: "chrome", headless: true,
    args: ["--disable-dev-shm-usage", "--enable-unsafe-swiftshader"],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    recordVideo: { dir: evidence }, serviceWorkers: "block",
  });
  await context.route("https://api.github.com/repos/Noty-design/Parametric-designs/git/trees/**", route =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ truncated: false, tree: [] }) }));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.dataset.brepiaClientReady === "true",
    null, { timeout: 60000 });
  await page.locator('input[type="file"][accept=".scad,.scad.txt"]').setInputFiles({
    name: "move-fixture.scad", mimeType: "text/plain",
    buffer: Buffer.from("cube([20,20,20],center=true);\n"),
  });
  await page.getByTestId("off-component-inspector").waitFor({ state: "visible", timeout: 90000 });
  await page.getByRole("button", { name: "Cancel preview" }).waitFor({ state: "hidden", timeout: 90000 });
  await page.getByRole("button", { name: "Experimental menu" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Enable visual move and diagnostics" }).click();
  const moveToggle = page.getByRole("button", { name: "Preview visual movement" });
  console.log("MOVE_TOGGLE_BEFORE", await moveToggle.getAttribute("aria-pressed"));
  if (await moveToggle.getAttribute("aria-pressed") !== "true") await moveToggle.click();
  console.log("MOVE_TOGGLE_STATE", await moveToggle.getAttribute("aria-pressed"),
    "viewport", await page.evaluate(() => [window.innerWidth, window.innerHeight]),
    "scene", await page.getByTestId("visual-move-preview").innerText());
  const panel = page.getByTestId("visual-move-mobile-controls");
  await panel.waitFor({ timeout: 10000 }).catch(async error => {
    await page.screenshot({ path: path.join(evidence, "move-panel-missing.png"), fullPage: true });
    throw new Error("Mobile controls not visible after move toggle: " +
      await moveToggle.getAttribute("aria-pressed") + " / " + error.message);
  });
  const offsets = page.getByTestId("visual-move-offsets");
  const preview = page.getByRole("region", { name: "3D model preview" });
  const canvas = preview.locator("canvas").first();
  const box = await canvas.boundingBox();
  assert.ok(box && box.width > 100 && box.height > 100, "Missing canvas");
  const centerX = Math.round(box.x + box.width / 2);
  const centerY = Math.round(box.y + box.height / 2);
  const cdp = await context.newCDPSession(page);
  const send = (type, x, y) => cdp.send("Input.dispatchTouchEvent", {
    type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }],
  });
  await canvas.screenshot({ path: path.join(evidence, "before-drag.png") });
  await send("touchStart", centerX, centerY);
  for (let step = 1; step <= 12; step++) {
    await send("touchMove", centerX + step * 8, centerY + step * 2);
    await pause(60);
  }
  const during = await offsets.textContent();
  await canvas.screenshot({ path: path.join(evidence, "during-drag.png") });
  await send("touchEnd", centerX + 96, centerY + 24);
  const after = await offsets.textContent();
  assert.ok(after && !after.includes("X 0.0 / Y 0.0 / Z 0.0"),
    "Touch drag must update preview translation: " + after + ", during=" + during);
  await panel.getByRole("button", { name: "Reset position" }).click();
  assert.match(await offsets.textContent(), /X 0\.0 \/ Y 0\.0 \/ Z 0\.0/, "Reset should zero translation");
  assert.deepEqual(errors, [], "Unexpected JS errors");
  await canvas.screenshot({ path: path.join(evidence, "after-reset.png") });
  console.log("VISUAL_MOVE_TOUCH_PASS " + JSON.stringify({ during, after }));
  await context.close();
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
