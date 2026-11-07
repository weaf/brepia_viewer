import { chromium } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const logo = (await readFile(path.join(root, "public/brepia-logo.svg"), "utf8"))
  .replaceAll("currentColor", "#f5f7fa");
const html = [
  "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">",
  "<style>",
  "*{box-sizing:border-box}html,body{margin:0;width:1200px;height:630px}",
  "body{background:#191a1a;color:#f5f7fa;font-family:Arial,sans-serif}",
  ".canvas{position:relative;width:1200px;height:630px;overflow:hidden;padding:86px 88px}",
  ".canvas:before{content:\"\";position:absolute;inset:0;opacity:.1;background-image:linear-gradient(#64748b 1px,transparent 1px),linear-gradient(90deg,#64748b 1px,transparent 1px);background-size:44px 44px}",
  ".content{position:relative;z-index:1}.logo{width:420px;height:112px;display:block}",
  "h1{font-size:52px;line-height:1.15;max-width:960px;margin:72px 0 14px;font-weight:700;letter-spacing:-1px}",
  "p{font-size:23px;margin:0;color:#b6c0cb}",
  ".stripe{position:absolute;left:88px;right:88px;bottom:56px;height:4px;background:linear-gradient(90deg,#00a6ff,#8b5cf6)}",
  "</style></head><body><div class=\"canvas\"><div class=\"content\"><div class=\"logo\">",
  logo,
  "</div><h1>OpenSCAD editor &amp; 3D viewer</h1>",
  "<p>Edit .scad files &nbsp; / &nbsp; Preview 3D models &nbsp; / &nbsp; Export STL</p>",
  "</div><div class=\"stripe\"></div></div></body></html>",
].join("");

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await mkdir(path.join(root, "public"), { recursive: true });
  await page.screenshot({ path: path.join(root, "public/og-brepia-viewer.png") });
  console.log("Created public/og-brepia-viewer.png (1200x630)");
} finally {
  await browser.close();
}
