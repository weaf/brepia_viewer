import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "@playwright/test";

const origin = "http://127.0.0.1:4187/";
const output = process.env.RUNNER_TEMP
  ? path.join(process.env.RUNNER_TEMP, "viewer-static-evidence")
  : path.resolve(".output/static-evidence");
await mkdir(output, { recursive: true });

const server = spawn("python3", [
  "-m", "http.server", "4187", "--bind", "127.0.0.1",
  "--directory", path.resolve(".output/public"),
], { stdio: ["ignore", "pipe", "pipe"] });
let stderr = "";
server.stderr.on("data", data => { stderr += data.toString(); });

const scad = [
  "width = 10; // [1:100]",
  "height = 20; // [1:100]",
  'label = "small";',
  "enabled = true;",
  "dimensions = [10, 20, 3];",
  "cube([width, height, dimensions[2]]);",
  "",
].join("\n");

const imported = JSON.stringify({
  fileFormatVersion: "1",
  parameterSets: {
    Wide: { width: "35", height: "12", label: "wide", enabled: "false", dimensions: "[35,12,4]", obsolete: "123" },
    Tall: { width: "5", height: "70", label: "tall", enabled: "true", dimensions: "[5,70,6]" },
    Partial: { width: "22" },
    "New set 1": { width: "11" },
    "New set 2": { width: "12" },
  },
});

let browser;
const failures = [];
async function checkDevice(device) {
  const context = await browser.newContext({
    viewport: { width: device.width, height: device.height },
    isMobile: device.mobile,
    hasTouch: device.mobile,
    deviceScaleFactor: device.mobile ? 2 : 1,
    acceptDownloads: true,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));

  const enable = async () => {
    if (await page.getByTestId("saved-variants-panel").count()) return;
    await page.getByRole("button", { name: "Experimental menu" }).click();
    const experiment = page.getByRole("menuitemcheckbox", { name: "Enable Experimental mode" });
    if (await experiment.getAttribute("data-state") !== "checked") {
      await experiment.click();
    } else {
      await page.keyboard.press("Escape");
    }
    if (await page.getByTestId("saved-variants-panel").count()) return;
    await page.getByRole("button", { name: "Experimental menu" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Enable Saved variants" }).click();
    await page.getByTestId("saved-variants-panel").waitFor({ state: "visible" });
  };

  try {
    console.log("[" + device.name + "] upload model");
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await page.getByText("Model gallery", { exact: true }).waitFor({ timeout: 35000 });
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("button", { name: "Upload model", exact: true }).click(),
    ]);
    await chooser.setFiles({ name: "saved-variants-smoke.scad", mimeType: "text/plain", buffer: Buffer.from(scad) });
    await page.getByText("Source and parameters", { exact: true }).waitFor({ timeout: 45000 });
    assert.equal(await page.getByTestId("saved-variants-panel").count(), 0, "Saved variants visible before Experimental opt-in");
    await enable();

    const panel = page.getByTestId("saved-variants-panel");
    const select = panel.getByRole("combobox", { name: "Choose saved variant" });
    await panel.getByRole("textbox", { name: "Name for new variant" }).fill("Initial");
    await panel.getByRole("button", { name: "Save new variant" }).click();
    await page.waitForFunction(() => {
      const select = document.querySelector('[aria-label="Choose saved variant"]');
      return select && Array.from(select.options).some(option => option.value === "Initial");
    });

    await panel.locator('input[type="file"]').setInputFiles({
      name: "saved-variants.json", mimeType: "application/json", buffer: Buffer.from(imported),
    });
    await page.waitForFunction(() =>
      Array.from(document.querySelector('[aria-label="Choose saved variant"]')?.options ?? [])
        .some(option => option.value === "Wide"));
    await select.selectOption("Wide");
    await page.getByRole("textbox", { name: "Width", exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('input[name="width"]')?.value === "35");
    assert.equal(await page.getByRole("textbox", { name: "Height", exact: true }).inputValue(), "12");
    assert.equal(await page.getByRole("textbox", { name: "Width", exact: true }).inputValue(), "35");

    // Saving without a name is a first-class action, even after import.
    const saveNewVariant = panel.getByRole("button", { name: "Save new variant" });
    assert.equal(await saveNewVariant.isEnabled(), true, "Save new variant must not be disabled when the name is empty");
    assert.equal(await panel.getByRole("textbox", { name: "Name for new variant" }).inputValue(), "");
    await saveNewVariant.click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Choose saved variant"]')?.value === "New set 3");
    await saveNewVariant.click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Choose saved variant"]')?.value === "New set 4");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      panel.getByRole("button", { name: "Export JSON" }).click(),
    ]);
    const downloaded = JSON.parse(await readFile(await download.path(), "utf8"));
    assert.equal(downloaded.fileFormatVersion, "1");
    assert.equal(downloaded.parameterSets.Wide.dimensions, "[35,12,4]");
    assert.equal(downloaded.parameterSets.Tall.height, "70");
    assert.equal(downloaded.parameterSets.Wide.obsolete, "123");
    assert.equal(downloaded.parameterSets["New set 1"].width, "11", "Imported variant must not be overwritten");
    assert.equal(downloaded.parameterSets["New set 2"].width, "12", "Imported variant must not be overwritten");
    assert.equal(downloaded.parameterSets["New set 3"].width, "35", "Auto-named variant must capture active Customizer values");
    assert.equal(downloaded.parameterSets["New set 4"].width, "35", "Repeated one-tap save must not overwrite");

    await select.selectOption("Tall");
    await page.waitForFunction(() => document.querySelector('input[name="width"]')?.value === "5");
    assert.equal(await page.getByRole("textbox", { name: "Height", exact: true }).inputValue(), "70");
    await select.selectOption("Partial");
    await page.waitForFunction(() => document.querySelector('input[name="width"]')?.value === "22");
    assert.equal(await page.getByRole("textbox", { name: "Height", exact: true }).inputValue(), "20", "Partial presets restore omitted parameters to original");
    await panel.getByRole("button", { name: "Original" }).click();
    await page.waitForFunction(() => document.querySelector('input[name="width"]')?.value === "10");
    assert.equal(await page.getByRole("textbox", { name: "Height", exact: true }).inputValue(), "20");

    await select.selectOption("Wide");
    await page.waitForFunction(() => document.querySelector('input[name="width"]')?.value === "35");
    await page.screenshot({ path: path.join(output, device.name + "-saved-variants.png"), fullPage: true });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Open saved-variants-smoke", exact: true }).waitFor({ timeout: 40000 });
    await page.getByRole("button", { name: "Open saved-variants-smoke", exact: true }).click();
    await page.getByText("Source and parameters", { exact: true }).waitFor({ timeout: 45000 });
    await enable();
    assert.equal(await page.getByTestId("saved-variants-panel").getByRole("combobox", { name: "Choose saved variant" }).inputValue(), "Wide");
    assert.equal(await page.getByRole("textbox", { name: "Width", exact: true }).inputValue(), "35");

    await panel.getByRole("button", { name: "Rename" }).click();
    await panel.getByRole("textbox", { name: "New variant name" }).fill("Wide renamed");
    await panel.getByRole("button", { name: "Save name" }).click();
    await page.waitForFunction(() =>
      Array.from(document.querySelector('[aria-label="Choose saved variant"]')?.options ?? [])
        .some(option => option.value === "Wide renamed"));

    page.once("dialog", dialog => void dialog.accept());
    await panel.getByRole("button", { name: "Delete" }).click();
    await page.waitForFunction(() =>
      !Array.from(document.querySelector('[aria-label="Choose saved variant"]')?.options ?? [])
        .some(option => option.value === "Wide renamed"));

    assert.deepEqual(errors, [], "Uncaught browser errors");
    console.log("[" + device.name + "] PASS Saved Variants JSON, one-tap save, switch, reset, reload, rename, delete");
  } catch (error) {
    failures.push(device.name + ": " + (error?.stack ?? String(error)));
    await page.screenshot({ path: path.join(output, device.name + "-saved-variants-failed.png"), fullPage: true }).catch(() => {});
  } finally {
    await context.close();
  }
}

try {
  for (let i = 0; i < 50; i++) {
    try {
      const response = await fetch(origin);
      if (response.ok) break;
    } catch (error) {
      if (i === 49) throw error;
    }
    if (i === 49) throw new Error("Static server unavailable: " + stderr);
    await sleep(200);
  }
  browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-dev-shm-usage", "--enable-unsafe-swiftshader"] });
  await checkDevice({ name: "desktop", width: 1440, height: 900, mobile: false });
  await checkDevice({ name: "mobile", width: 390, height: 844, mobile: true });
  if (failures.length) throw new Error(failures.join("\n\n"));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
