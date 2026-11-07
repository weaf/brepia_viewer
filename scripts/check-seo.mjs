import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", ".output/public");
const read = (name) => readFileSync(path.join(root, name), "utf8");

function getPage(route) {
  const candidates = route === "/"
    ? ["index.html"]
    : [route.slice(1) + "/index.html", route.slice(1) + ".html", route.slice(1)];
  for (const file of candidates) {
    if (existsSync(path.join(root, file))) return read(file);
  }
  throw new Error("Missing prerendered page: " + route);
}
function verifyPage(route, titleFragment) {
  const html = getPage(route);
  assert.match(html, /<title>[^<]+<\/title>/, "Missing title for " + route);
  assert.ok(html.includes(titleFragment), "Missing title keyword for " + route);
  assert.match(html, /name="description"/, "Missing description for " + route);
  assert.ok(/rel="canonical"/.test(html), "Missing canonical for " + route);
  const expectedCanonical = "https://viewer.notydesign.se" + (route === "/" ? "/" : route + "/");
  const canonicalTag = html.match(/<link[^>]*rel="canonical"[^>]*>/)?.[0];
  assert.ok(canonicalTag?.includes("href=\"" + expectedCanonical + "\""), "Wrong canonical for " + route);
  assert.ok(!html.includes("noindex"), "Unexpected noindex on " + route);
  return html;
}
const home = verifyPage("/", "OpenSCAD Editor");
const about = verifyPage("/about", "About Brepia Viewer");
verifyPage("/privacy-policy", "Privacy Policy");
verifyPage("/terms-of-service", "Terms of Service");

assert.match(home, /application\/ld\+json/);
assert.match(home, /WebApplication/);
assert.match(home, /og:image/);
assert.match(home, /twitter:card/);
assert.match(home, /<h1[^>]*>[\s\S]*?Model gallery[\s\S]*?<\/h1>/);
assert.ok(home.includes("href=\"/about/\""), "Homepage does not link to canonical About page");
assert.match(about, /OpenSCAD editor and 3D viewer/i);
assert.match(about, /IndexedDB/);

const robots = read("robots.txt");
assert.match(robots, /User-agent: \*/);
assert.match(robots, /OAI-SearchBot/);
assert.match(robots, /Sitemap: https:\/\/viewer\.notydesign\.se\/sitemap\.xml/);
const sitemap = read("sitemap.xml");
for (const url of ["/", "/about", "/privacy-policy", "/terms-of-service"]) {
  const sitemapPath = url === "/" ? "/" : url + "/";
  assert.ok(sitemap.includes("<loc>https://viewer.notydesign.se" + sitemapPath + "</loc>"), "Missing canonical sitemap URL for " + url);
}
const guide = read("llms.txt");
assert.ok(guide.includes("https://viewer.notydesign.se/about"));
const image = readFileSync(path.join(root, "og-brepia-viewer.png"));
assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
assert.equal(image.readUInt32BE(16), 1200);
assert.equal(image.readUInt32BE(20), 630);
const manifest = JSON.parse(read("site.webmanifest"));
assert.match(manifest.description, /OpenSCAD/);
console.log("SEO static gates PASS: canonical metadata, JSON-LD, social image, sitemap, robots, AI guide and visible About content.");
