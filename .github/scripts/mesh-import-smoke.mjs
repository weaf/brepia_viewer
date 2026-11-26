import { chromium } from "@playwright/test";
import { zipSync, strToU8 } from "fflate";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const origin = "http://127.0.0.1:4194";
const evidence = process.env.RUNNER_TEMP
  ? path.join(process.env.RUNNER_TEMP, "viewer-static-evidence")
  : path.resolve(".output/static-evidence");
await mkdir(evidence, { recursive: true });
const server = spawn("python3", ["-m", "http.server", "4194", "--bind", "127.0.0.1",
  "--directory", ".output/public"], { stdio: "ignore" });

function cubeStl() {
  const v = [[0,0,0],[10,0,0],[10,10,0],[0,10,0],[0,0,10],[10,0,10],[10,10,10],[0,10,10]];
  const faces = [[0,3,2],[0,2,1], [4,5,6],[4,6,7], [0,1,5],[0,5,4],
    [1,2,6],[1,6,5], [2,3,7],[2,7,6], [3,0,4],[3,4,7]];
  const data = Buffer.alloc(84 + faces.length * 50);
  data.writeUInt32LE(faces.length, 80);
  for (let i=0;i<faces.length;i++) {
    for (let j=0;j<3;j++) for(let k=0;k<3;k++) {
      data.writeFloatLE(v[faces[i][j]][k], 84 + i*50 + 12 + j*12 + k*4);
    }
  }
  return data;
}
const bytes = cubeStl();
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<resources><object id="1" type="model"><mesh><vertices>
<vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/>
<vertex x="0" y="10" z="0"/><vertex x="0" y="0" z="10"/>
</vertices><triangles>
<triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/>
<triangle v1="0" v2="3" v3="2"/><triangle v1="1" v2="2" v3="3"/>
</triangles></mesh></object></resources><build><item objectid="1"/></build>
</model>`;
const threeMfBytes = Buffer.from(zipSync({
  "[Content_Types].xml": strToU8(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`),
  "_rels/.rels": strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`),
  "3D/3dmodel.model": strToU8(xml),
}));
/** Require actual painted blue/white mesh pixels, not just a mounted WebGL canvas. */
async function paintedMeshPixels(page, canvas) {
  // Three.js may replace the canvas while its mesh is attaching. Retry that
  // transient state rather than failing a model that becomes visibly rendered.
  let screenshot;
  try {
    const bounds = await canvas.boundingBox();
    if (!bounds || bounds.width < 70 || bounds.height < 70) return 0;
    // Canvas element screenshots can sample an empty WebGL drawing buffer when
    // preserveDrawingBuffer=false, even while the composed page visibly paints.
    // Screenshot the composited viewport region instead.
    screenshot = await page.screenshot({
      clip: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      timeout: 5000,
    });
  } catch {
    return 0;
  }
  return page.evaluate(async encoded => {
    const data = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([data], { type: "image/png" }));
    const surface = document.createElement("canvas");
    surface.width = bitmap.width;
    surface.height = bitmap.height;
    const context = surface.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const { data: pixels } = context.getImageData(0, 0, surface.width, surface.height);
    let colored = 0;
    const startX = Math.floor(surface.width * 0.1);
    const endX = Math.floor(surface.width * 0.9);
    const startY = Math.floor(surface.height * 0.1);
    const endY = Math.floor(surface.height * 0.8);
    for (let y = startY; y < endY; y += 3) {
      for (let x = startX; x < endX; x += 3) {
        const index = (y * surface.width + x) * 4;
        const red = pixels[index], green = pixels[index+1], blue = pixels[index+2];
        if (blue > red + 35 && blue > 85 &&
          Math.max(red, green, blue) - Math.min(red, green, blue) > 42) colored++;
      }
    }
    return colored;
  }, screenshot.toString("base64"));
}

let browser;
try {
  let ready = false;
  for (let i=0;i<80;i++) {
    try { if ((await fetch(origin)).ok) { ready=true;break; } } catch { /* server startup */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error("Static preview did not start.");
  browser = await chromium.launch({ channel: "chrome", headless: true,
    args: ["--disable-dev-shm-usage", "--enable-unsafe-swiftshader"] });
  for (const device of [{ name:"desktop",width:1280,height:800 },
                        { name:"mobile",width:390,height:844 }]) {
    for (const scenario of ["direct-stl", "direct-3mf", "local-stl", "local-3mf", "real-stl", "real-3mf"]) {
      const context=await browser.newContext({viewport:{width:device.width,height:device.height},
        serviceWorkers:"block"});
      const page=await context.newPage();
      const errors=[];
      page.on("pageerror",err=>errors.push(err.message));
      await context.route("https://api.github.com/repos/Noty-design/Parametric-designs/git/trees/**",route=>route.fulfill({
        status:200,contentType:"application/json",body:JSON.stringify({truncated:false,tree:[]}),
      }));
      await page.route("https://example.org/models/cube.stl",async route=>{
        await route.fulfill({status:200,contentType:"application/octet-stream",body:bytes,
          headers:{"access-control-allow-origin":"*"}});
      });
      await page.route("https://example.org/models/cube.3mf",async route=>{
        await route.fulfill({status:200,contentType:"application/octet-stream",body:threeMfBytes,
          headers:{"access-control-allow-origin":"*"}});
      });
      const raw="https://raw.githubusercontent.com/Noty-design/Parametric-designs/06d976968e0d3ae69299e722fe15428a11e71eed/";
      const links={
        "direct-stl":"https://example.org/models/cube.stl",
        "direct-3mf":"https://example.org/models/cube.3mf",
        "real-stl":raw+"elfa%20bracket/stl/Elfa_Shelf_Bracketv_8_7.stl",
        "real-3mf":raw+"snowflake/3mf/openscadsnowflake.3mf",
      };
      const real = scenario.startsWith("real-");
      const network = [];
      if (real) page.on("response",response=>{
        if (response.url()===links[scenario]) network.push(response.status());
      });
      const target=links[scenario] ? origin+"/?model="+encodeURIComponent(links[scenario]) : origin+"/";
      await page.goto(target,{waitUntil:"domcontentloaded",timeout:45000});
      await page.waitForFunction(()=>document.documentElement.dataset.brepiaClientReady==="true",
        null,{timeout:45000});

      if (scenario.startsWith("local-")) {
        const input=page.locator('input[type="file"][accept=".stl,.3mf"]');
        await input.setInputFiles({name:scenario==="local-3mf"?"cube.3mf":"cube.stl",mimeType:"application/octet-stream",buffer:scenario==="local-3mf"?threeMfBytes:bytes});
      }
      {
        try {
          await page.getByText("Source and parameters",{exact:true}).first().waitFor({timeout:60000});
        } catch (cause) {
          await page.screenshot({path:path.join(evidence,device.name+"-"+scenario+"-failure.png"),fullPage:true});
          throw new Error("Model did not open for "+scenario+": "+(await page.locator("body").innerText()).slice(0,2000), {cause});
        }
        await page.getByText(real ? /[0-9][0-9, ]* triangles/ : scenario.endsWith("3mf") ? /4 triangles/ : /12 triangles/)
          .first().waitFor({timeout:120000});
        if(real && !network.includes(200)) throw new Error("No real HTTP 200 model download: "+JSON.stringify(network));
        const canvas=page.locator('section[aria-label="3D model preview"] canvas').first();
        await canvas.waitFor({state:"visible",timeout:90000});
        try {
          await page.waitForFunction(() => {
            const canvas = document.querySelector('section[aria-label="3D model preview"] canvas');
            const rect = canvas?.getBoundingClientRect();
            return rect && rect.width >= 70 && rect.height >= 70;
          }, null, { timeout: 90000 });
          await page.evaluate(() => new Promise(resolve =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))));
          // A visible canvas + compiled triangle count can still be a blank first frame.
          // Observe the exact rendered pixels; do not accept an unpainted model.
          let painted = 0;
          for (let attempt = 0; attempt < 36; attempt++) {
            painted = await paintedMeshPixels(page, canvas);
            if (painted > 200) break;
            await page.waitForTimeout(300);
          }
          if (painted <= 200) {
            throw new Error("OpenSCAD compiled but the mesh did not paint in 3D: "+scenario+
              " ("+painted+" colored pixel samples).");
          }
        } catch (cause) {
          await page.screenshot({path:path.join(evidence,device.name+"-"+scenario+"-bounds-failure.png"),fullPage:true});
          throw new Error("3D canvas not ready for "+scenario+": "+JSON.stringify(await canvas.boundingBox())+
            " | "+(await page.locator("body").innerText()).slice(0,1200), {cause});
        }
      }
      await page.screenshot({path:path.join(evidence,device.name+"-"+scenario+".png"),fullPage:true});
      if(errors.length)throw new Error("Browser errors: "+errors.join("; "));
      await context.close();
      console.log("PASS",device.name,scenario);
    }
  }

} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
