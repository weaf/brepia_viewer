import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { chromium } from "@playwright/test";

const origin = "http://127.0.0.1:4193/";
const evidence = process.env.RUNNER_TEMP
  ? path.join(process.env.RUNNER_TEMP, "camera-zoom-evidence")
  : path.resolve(".output/camera-zoom-evidence");
await mkdir(evidence, { recursive: true });
const server = spawn("python3", [
  "-m", "http.server", "4193", "--bind", "127.0.0.1",
  "--directory", path.resolve(".output/public"),
], { stdio: ["ignore", "pipe", "pipe"] });
let serverErrors = "";
server.stderr.on("data", data => { serverErrors += data.toString(); });

let browser;
const failures = [];
try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    try { if ((await fetch(origin)).ok) { ready = true; break; } } catch { /* Startup retry. */ }
    await pause(250);
  }
  if (!ready) throw new Error("Static server unavailable: " + serverErrors);
  const html = await (await fetch(origin)).text();
  assert.ok(!html.includes("/brepia_viewer/assets/"), "Expected root-relative static assets");
  browser = await chromium.launch({
    channel: "chrome", headless: true,
    args: ["--disable-dev-shm-usage", "--enable-unsafe-swiftshader"],
  });

  for (const device of [
    { name: "desktop", width: 1440, height: 900, mobile: false },
    { name: "mobile", width: 390, height: 844, mobile: true },
  ]) {
    const context = await browser.newContext({
      viewport: { width: device.width, height: device.height },
      isMobile: device.mobile, hasTouch: device.mobile,
      serviceWorkers: "block",
    });
    await context.route("https://api.github.com/repos/Noty-design/Parametric-designs/git/trees/**", route =>
      route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ truncated: false, tree: [] }),
      }),
    );
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.goto(origin, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(
        () => document.documentElement.dataset.brepiaClientReady === "true",
        null, { timeout: 50000 },
      );
      await page.locator('input[type="file"][accept=".scad,.scad.txt"]').setInputFiles({
        name: "camera-parametric.scad",
        mimeType: "text/plain",
        buffer: Buffer.from(
          "/* [Shape] */\\nwidth = 10; // [5:1:30]\\nheight = 10; // [5:1:30]\\ncube([width,width,height], center=true);\\n".replaceAll("\\n", "\n"),
        ),
      });
      await page.getByText("Source and parameters", { exact: true }).waitFor({ timeout: 45000 });
      const preview = page.getByRole("region", { name: "3D model preview" });
      await page.getByTestId("off-component-inspector").waitFor({ state: "visible", timeout: 90000 });
      const autoFit = preview.locator("[data-camera-auto-fit]");
      await autoFit.waitFor({ state: "visible" });
      assert.equal(await autoFit.getAttribute("data-camera-auto-fit"), "true", "New model must initially fit");
      const canvas = preview.locator("canvas").first();
      await canvas.waitFor({ state: "visible" });
      await canvas.scrollIntoViewIfNeeded();
      await canvas.screenshot({ path: path.join(evidence, device.name + "-initial-fit.png") });
      const rect = await canvas.boundingBox();
      assert.ok(rect && rect.width > 100 && rect.height > 100, "Missing 3D canvas");
      await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      await page.mouse.wheel(0, -700);
      await page.waitForFunction(
        () => document.querySelector("[data-camera-auto-fit]")?.getAttribute("data-camera-auto-fit") === "false",
        null, { timeout: 12000 },
      );
      await page.waitForTimeout(350);
      await canvas.screenshot({ path: path.join(evidence, device.name + "-zoomed.png") });
      const widthInput = page.locator('input[name="width"]');
      await widthInput.fill("14");
      await widthInput.press("Tab");
      await page.waitForFunction(
        () => document.querySelector('input[name="width"]')?.value === "14",
        null, { timeout: 12000 },
      );
      // Allow the standalone WASM compiler to produce an updated mesh.
      await page.waitForTimeout(2500);
      await page.getByTestId("off-component-inspector").waitFor({ state: "visible", timeout: 90000 });
      await page.getByRole("button", { name: "Cancel preview" }).waitFor({ state: "hidden", timeout: 90000 });
      assert.equal(await autoFit.getAttribute("data-camera-auto-fit"), "false",
        "Recompiling a parameter must not re-enable Stage auto-fitting");
      await canvas.screenshot({ path: path.join(evidence, device.name + "-after-parameter.png") });

      // A different model starts in its own camera session and may auto-fit.
      await page.getByRole("button", { name: "Back to model gallery" }).click();
      await page.locator('input[type="file"][accept=".scad,.scad.txt"]').setInputFiles({
        name: "camera-new-model.scad", mimeType: "text/plain",
        buffer: Buffer.from("size=6; // [3:1:30]\\nsphere(r=size, $fn=12);\\n".replaceAll("\\n", "\n")),
      });
      await page.getByText("Source and parameters", { exact: true }).waitFor({ timeout: 45000 });
      await page.getByRole("region", { name: "3D model preview" })
        .locator("[data-camera-auto-fit]").waitFor({ state: "visible", timeout: 90000 });
      assert.equal(await page.getByRole("region", { name: "3D model preview" })
        .locator("[data-camera-auto-fit]").getAttribute("data-camera-auto-fit"), "true",
        "Opening a different model must re-enable initial camera fitting");
      assert.deepEqual(errors, [], "Unexpected JavaScript errors");
      console.log("CAMERA_ZOOM_PASS " + JSON.stringify({ device: device.name, autoFitAfterParam: false, newModelFit: true }));
    } catch (error) {
      failures.push(device.name + ": " + (error.stack || error.message));
      await page.screenshot({ path: path.join(evidence, device.name + "-failure.png"), fullPage: true }).catch(() => {});
    } finally {
      await context.close();
    }
  }
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
if (failures.length) { console.error(failures.join("\n\n")); process.exitCode = 1; }
