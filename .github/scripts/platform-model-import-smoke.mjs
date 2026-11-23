import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const origin = "http://127.0.0.1:4194";
const evidence = process.env.RUNNER_TEMP
  ? path.join(process.env.RUNNER_TEMP, "viewer-platform-evidence")
  : path.resolve(".output/platform-evidence");
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
    for (const scenario of ["printables", "direct-stl", "local-stl",
                            "thingiverse", "makerworld", "snapmaker"]) {
      const context=await browser.newContext({viewport:{width:device.width,height:device.height},
        serviceWorkers:"block"});
      const page=await context.newPage();
      const errors=[];
      page.on("pageerror",err=>errors.push(err.message));
      await page.route("https://api.printables.com/graphql/**",async route=>{
        const request=route.request().postData() || "";
        const payload=request.includes("getDownloadLink")
          ? {data:{getDownloadLink:{ok:true,output:{link:"https://files.printables.com/media/prints/cube.stl"}}}}
          : {data:{print:{name:"Test printed model",stls:[
            {id:"11",name:"cube.stl",fileSize:bytes.length},
            {id:"12",name:"second.3mf",fileSize:900}]}}};
        await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(payload),
          headers:{"access-control-allow-origin":"*"}});
      });
      await page.route("https://files.printables.com/media/prints/cube.stl",async route=>{
        await route.fulfill({status:200,contentType:"application/octet-stream",body:bytes,
          headers:{"access-control-allow-origin":"*"}});
      });
      await page.route("https://example.org/models/cube.stl",async route=>{
        await route.fulfill({status:200,contentType:"application/octet-stream",body:bytes,
          headers:{"access-control-allow-origin":"*"}});
      });
      const links={
        "printables":"https://www.printables.com/model/3161-3d-benchy",
        "thingiverse":"https://www.thingiverse.com/thing:763622",
        "makerworld":"https://makerworld.com/en/models/24966-example",
        "snapmaker":"https://space.snapmaker.com/en/model/24313",
        "direct-stl":"https://example.org/models/cube.stl",
      };
      const target=links[scenario] ? origin+"/?model="+encodeURIComponent(links[scenario]) : origin+"/";
      await page.goto(target,{waitUntil:"domcontentloaded",timeout:45000});
      await page.waitForFunction(()=>document.documentElement.dataset.brepiaClientReady==="true",
        null,{timeout:45000});

      if (scenario==="printables") {
        const region=page.getByRole("region",{name:"Platform model import"});
        await region.waitFor({timeout:30000});
        await page.getByLabel("Select a model file").selectOption("11");
        await page.getByRole("button",{name:"Import selected file"}).click();
      } else if(["thingiverse","makerworld","snapmaker"].includes(scenario)) {
        const region=page.getByRole("region",{name:"Platform model import"});
        await region.waitFor({timeout:20000});
        const link=region.getByRole("link",{name:"Open original model page"});
        await link.waitFor({timeout:10000});
        if(await link.getAttribute("href")!==links[scenario]){
          throw new Error("Incorrect platform handoff for "+scenario);
        }
      } else if(scenario==="local-stl") {
        const input=page.locator('input[type="file"][accept=".scad,.scad.txt,.stl,.3mf"]');
        await input.setInputFiles({name:"cube.stl",mimeType:"application/octet-stream",buffer:bytes});
      }
      if(!["thingiverse","makerworld","snapmaker"].includes(scenario)) {
        try {
          await page.getByText("Source and parameters",{exact:true}).first().waitFor({timeout:60000});
        } catch (cause) {
          await page.screenshot({path:path.join(evidence,device.name+"-"+scenario+"-failure.png"),fullPage:true});
          throw new Error("Model did not open for "+scenario+": "+(await page.locator("body").innerText()).slice(0,2000), {cause});
        }
        await page.getByText(/12 triangles/).first().waitFor({timeout:120000});
        const canvas=page.locator('section[aria-label="3D model preview"] canvas').first();
        await canvas.waitFor({state:"visible",timeout:90000});
        const bounds=await canvas.boundingBox();
        if(!bounds || bounds.width<70 || bounds.height<70)throw new Error("Mesh not visible: "+scenario);
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
