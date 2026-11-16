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
  const collapsedPanel = await panel.boundingBox();
  assert.ok(collapsedPanel && collapsedPanel.height <= 60,
    "Mobile precision controls must be compact by default: " + collapsedPanel?.height);
  await panel.getByRole("button", { name: "Show precision slider" }).click();
  await page.getByTestId("visual-move-mobile-precision").waitFor();
  await panel.getByRole("slider", { name: "Move model along X axis" }).waitFor();
  await panel.getByRole("button", { name: "Hide precision slider" }).click();
  await page.getByTestId("visual-move-mobile-precision").waitFor({ state: "hidden" });
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
  const repeatedDrags = [];
  for (const axisIndex of [1, 2, 0]) {
    await panel.getByRole("combobox", { name: "Visual move axis" }).selectOption(String(axisIndex));
    await send("touchStart", centerX, centerY);
    for (let step = 1; step <= 12; step++) {
      await send("touchMove", centerX + step * 6, centerY - step * 6);
      await pause(45);
    }
    await send("touchEnd", centerX + 72, centerY - 72);
    const valueText = await offsets.textContent();
    const values = valueText?.match(/Scene X (-?\d+\.\d+) \/ Y (-?\d+\.\d+) \/ Z (-?\d+\.\d+)/);
    assert.ok(values && Math.abs(Number(values[axisIndex + 1])) >= 0.1,
      "Drag must move selected axis " + axisIndex + ": " + valueText);
    for (let other = 0; other < 3; other++) {
      if (other !== axisIndex) assert.ok(Math.abs(Number(values[other + 1])) < 0.1,
        "Dragging one axis must not move another: " + valueText);
    }
    repeatedDrags.push({ axisIndex, offsets: valueText });
    await panel.getByRole("button", { name: "Reset position" }).click();
  }
  assert.equal(await preview.locator("[data-camera-auto-fit]").getAttribute("data-camera-auto-fit"), "false",
    "Moving the preview must not re-enable camera auto-fitting");
  console.log("VISUAL_MOVE_AXES_PASS", JSON.stringify(repeatedDrags));
  assert.deepEqual(errors, [], "Unexpected JS errors");
  await canvas.screenshot({ path: path.join(evidence, "after-reset.png") });
  console.log("VISUAL_MOVE_TOUCH_PASS " + JSON.stringify({ during, after }));
  await context.close();
  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: evidence }, serviceWorkers: "block",
  });
  await desktop.route("https://api.github.com/repos/Noty-design/Parametric-designs/git/trees/**", route =>
    route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ truncated: false, tree: [] }) }));
  const desktopPage = await desktop.newPage();
  const desktopErrors = [];
  desktopPage.on("pageerror", error => desktopErrors.push(error.message));
  try {
    await desktopPage.goto(origin, { waitUntil: "domcontentloaded" });
    await desktopPage.waitForFunction(
      () => document.documentElement.dataset.brepiaClientReady === "true",
      null, { timeout: 60000 },
    );
    await desktopPage.locator('input[type="file"][accept=".scad,.scad.txt"]').setInputFiles({
      name: "move-desktop.scad", mimeType: "text/plain",
      buffer: Buffer.from("cube([20,20,20],center=true);\n"),
    });
    await desktopPage.getByTestId("off-component-inspector").waitFor({ state: "visible", timeout: 90000 });
    await desktopPage.getByRole("button", { name: "Cancel preview" })
      .waitFor({ state: "hidden", timeout: 90000 });
    await desktopPage.getByRole("button", { name: "Experimental menu" }).click();
    await desktopPage.getByRole("menuitemcheckbox",
      { name: "Enable visual move and diagnostics" }).click();
    const desktopMoveToggle = desktopPage.getByRole("button", { name: "Preview visual movement" });
    if (await desktopMoveToggle.getAttribute("aria-pressed") !== "true") {
      await desktopMoveToggle.click();
    }
    assert.equal(await desktopMoveToggle.getAttribute("aria-pressed"), "true");
    const desktopCanvas = desktopPage.getByRole("region",
      { name: "3D model preview" }).locator("canvas").first();
    await desktopCanvas.waitFor({ state: "visible" });
    await pause(400);
    const dc = await desktopCanvas.boundingBox();
    assert.ok(dc && dc.width > 250 && dc.height > 200,
      "Desktop 3D canvas is missing");
    const px = dc.x + dc.width / 2;
    const py = dc.y + dc.height / 2;
    const desktopOffsets = desktopPage.getByTestId("visual-move-offsets");
    const desktopAxes = [];
    await desktopCanvas.screenshot({ path: path.join(evidence, "desktop-initial.png") });
    for (const [axisId, dx, dy] of [[0, 160, 60], [1, 80, -140], [2, -150, -100]]) {
      await desktopPage.getByRole("combobox", { name: "Visual move axis" })
        .selectOption(String(axisId));
      await desktopPage.mouse.move(px, py);
      await desktopPage.mouse.down();
      const samples = [];
      for (let i = 1; i <= 12; i++) {
        await desktopPage.mouse.move(px + dx * i / 12, py + dy * i / 12, { steps: 2 });
        if (i % 3 === 0) {
          const value = await desktopOffsets.textContent();
          samples.push(value);
        }
        await pause(45);
      }
      await desktopCanvas.screenshot({ path: path.join(evidence,
        "desktop-axis-" + axisId + "-during.png") });
      await desktopPage.mouse.up();
      const result = await desktopOffsets.textContent();
      const match = result?.match(/Scene X (-?\d+\.\d+) \/ Y (-?\d+\.\d+) \/ Z (-?\d+\.\d+)/);
      assert.ok(match && Math.abs(Number(match[axisId + 1])) > 0.2,
        "Desktop drag did not translate along axis " + axisId + ": " + result);
      assert.ok(new Set(samples).size >= 2,
        "Desktop offset must change during a single mouse-down gesture: " + samples);
      for (let other = 0; other < 3; other++) {
        if (other !== axisId) {
          assert.ok(Math.abs(Number(match[other + 1])) < 0.1,
            "Desktop drag leaked to another axis: " + result);
        }
      }
      desktopAxes.push({ axisId, result, samples });
      await desktopPage.getByRole("button", { name: "Reset position" }).click();
      assert.match(await desktopOffsets.textContent(), /X 0\.0 \/ Y 0\.0 \/ Z 0\.0/);
    }
    assert.equal(await desktopPage.locator("[data-camera-auto-fit]").first()
      .getAttribute("data-camera-auto-fit"), "false",
      "Mouse dragging must not activate Stage camera refitting");
    await desktopMoveToggle.click();
    assert.equal(await desktopMoveToggle.getAttribute("aria-pressed"), "false",
      "Move must be deactivatable after dragging");
    assert.deepEqual(desktopErrors, [], "Unexpected desktop JS errors");
    console.log("VISUAL_MOVE_DESKTOP_PASS " + JSON.stringify(desktopAxes));
  } catch (error) {
    await desktopPage.screenshot({ path: path.join(evidence, "desktop-failure.png"),
      fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await desktop.close();
  }
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
