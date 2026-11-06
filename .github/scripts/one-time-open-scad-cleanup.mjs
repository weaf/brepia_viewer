#!/usr/bin/env node
/**
 * One-time repository reduction, executed only on the dedicated cleanup branch.
 * Derives source reachability from the actual OpenSCAD app entrypoints, retains
 * OpenSCAD WASM/vendor assets, and removes original Brepia-only subsystems.
 *
 * Not part of the distributed application; this file and its workflow remove
 * themselves before the resulting branch commit.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const root = process.cwd();
const repoFile = (p) => path.join(root, p);
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0').filter(Boolean);
const trackedSet = new Set(tracked);
const read = (p) => fs.readFileSync(repoFile(p), 'utf8');
const write = (p, content) => fs.writeFileSync(repoFile(p), content);
const replace = (p, from, to) => {
  const s = read(p);
  if (!s.includes(from)) throw new Error('Expected text absent in ' + p + ': ' + from.slice(0, 80));
  write(p, s.replace(from, to));
};

const gallery = 'src/views/ModelGalleryView.tsx';
replace(gallery, 'import { exportStep } from "@/services/stepExport";\n', '');
replace(gallery,
  'type ModelExportFormat = "scad" | "step" | EnabledOpenScadExportFormat;\nconst isStaticViewer = import.meta.env.VITE_STATIC_VIEWER === "1";',
  'type ModelExportFormat = "scad" | EnabledOpenScadExportFormat;');
replace(gallery,
  '    if (format === "step") {\n      return !isStaticViewer && (activeRecord.project.assets?.length ?? 0) === 0;\n    }\n',
  '');
const galleryText = read(gallery);
const stepHandlerBegin = '      } else if (format === "step") {\n';
const stepHandlerStart = galleryText.indexOf(stepHandlerBegin);
if (stepHandlerStart < 0) throw new Error('STEP export handler missing');
const stepHandlerEnd = galleryText.indexOf('      } else {\n', stepHandlerStart + stepHandlerBegin.length);
if (stepHandlerEnd < 0) throw new Error('STEP handler end missing');
write(gallery,
  galleryText.slice(0, stepHandlerStart) + '      } else {\n' +
  galleryText.slice(stepHandlerEnd + '      } else {\n'.length));
replace(gallery, '["stl", "scad", "dxf", "step"] as const', '["stl", "scad", "dxf"] as const');
const after = read(gallery);
const menuStart = after.indexOf('                {!isStaticViewer && (\n');
if (menuStart < 0) throw new Error('Static-only STEP menu missing');
const menuEnd = after.indexOf('                )}\n', menuStart);
if (menuEnd < 0) throw new Error('STEP menu end missing');
write(gallery, after.slice(0, menuStart) + after.slice(menuEnd + '                )}\n'.length));
if (/exportStep|isStaticViewer|"step"|\.STEP/.test(read(gallery))) {
  throw new Error('STEP reference remains in model gallery');
}

// The browser's parameter, mesh and OpenSCAD types must not pull in
// legacy database, chat or BREP source graphs through shared/types.ts.
write('shared/types.ts', `import type { OpenScadProject } from './openScadProject.ts';

export type Model = string;
export type MeshFileType = string;
export type Mesh = { id: string; fileType: MeshFileType };
export type ParametricArtifact = {
  title: string;
  version: string;
  project: OpenScadProject;
};
export type ParameterOption = { value: string | number; label?: string };
export type ParameterRange = { min?: number; max?: number; step?: number };
export type ParameterType =
  | 'string' | 'number' | 'boolean'
  | 'string[]' | 'number[]' | 'boolean[]';
export type Parameter = {
  name: string;
  displayName: string;
  value: string | boolean | number | string[] | number[] | boolean[];
  defaultValue: string | boolean | number | string[] | number[] | boolean[];
  type?: ParameterType;
  description?: string;
  group?: string;
  range?: ParameterRange;
  options?: ParameterOption[];
  maxLength?: number;
};
`);

// Only the filename sanitizer is used by the active OpenSCAD gallery.
// Historical filename helpers depended on AI-message parts and BREP tools.
write('src/utils/file-utils.ts', `/** Make uploaded and exported OpenSCAD filenames safe on disk. */
export function getSafeFilename(baseFilename: string, fallback?: string): string {
  const filename = baseFilename?.trim() ? baseFilename.trim() : fallback || 'file';
  return filename.replace(/[/\\\\?%*:|"<>]/g, '-').replace(/\\s+/g, '_');
}
`);

const keep = new Set();
const parents = new Map();
const unresolved = new Set();
const packages = new Set();
const queue = [];
const entries = [
  'src/App.tsx',
  'src/client.tsx',
  'src/router.tsx',
  'src/routeTree.gen.ts',
  'src/vite-env.d.ts',
  'src/index.css',
  'src/appearance.css',
  'src/worker/worker.ts',
  'shared/parseParameters.test.ts',
  'src/routes/__root.tsx',
  'src/routes/_layout.tsx',
  'src/routes/_layout/index.tsx',
  'src/routes/assets.$.ts',
  'src/routes/privacy-policy.tsx',
  'src/routes/terms-of-service.tsx',
];
const exts = ['', '.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs', '.json', '.css', '.svg', '.png', '.jpg', '.webp', '.wasm'];
function push(p) {
  p = p.replaceAll('\\', '/');
  if (!trackedSet.has(p) || keep.has(p)) return;
  keep.add(p);
  queue.push(p);
}
for (const p of entries) {
  if (!trackedSet.has(p)) throw new Error('Missing required OpenSCAD entrypoint: ' + p);
  push(p);
}
for (const p of tracked) {
  if (p.startsWith('src/vendor/openscad-wasm/')) push(p);
}

function externalPackage(spec) {
  if (spec.startsWith('node:') || spec.startsWith('virtual:') || spec.startsWith('#')) return;
  if (spec.startsWith('@')) {
    const parts = spec.split('/');
    if (parts.length >= 2) packages.add(parts.slice(0, 2).join('/'));
  } else {
    packages.add(spec.split('/')[0]);
  }
}
function importTarget(origin, spec) {
  spec = spec.split('?')[0].split('#')[0];
  if (!spec) return;
  let base;
  if (spec.startsWith('@/')) base = 'src/' + spec.slice(2);
  else if (spec.startsWith('@shared/')) base = 'shared/' + spec.slice(8);
  else if (spec.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(origin), spec));
  else { externalPackage(spec); return; }
  if (base.startsWith('..')) throw new Error('Unexpected path outside project: ' + origin + ': ' + spec);
  const candidates = new Set([base]);
  for (const x of exts) candidates.add(base + x);
  const withoutExt = base.replace(/\.(js|mjs|jsx)$/, '');
  if (withoutExt !== base) for (const x of exts) candidates.add(withoutExt + x);
  for (const x of exts) candidates.add(base + '/index' + x);
  for (const c of candidates) {
    if (trackedSet.has(c)) { if (!parents.has(c)) parents.set(c, origin); push(c); return; }
  }
  unresolved.add(origin + ' <- ' + spec);
}

const importRe = /(?:\bimport\s*\(\s*|\bimport\s+|\bexport\s+[^;]*?\s+from\s+|\brequire\s*\(\s*|\bnew URL\s*\(\s*)["']([^"'()]+)["']/g;
while (queue.length) {
  const file = queue.shift();
  if (!/\.(tsx?|jsx?|mjs|mts|css|json)$/.test(file)) continue;
  // Generated route tree is automatically rebuilt after removing the STEP route.
  if (file === 'src/routeTree.gen.ts') continue;
  const code = read(file);
  if (file.endsWith('.json')) continue;
  if (file.endsWith('.css')) {
    for (const m of code.matchAll(/@import\s+(?:url\()?["']([^"'()]+)["']/g)) {
      importTarget(file, m[1]);
    }
    for (const m of code.matchAll(/url\(\s*["']?([^)'"]+)["']?\s*\)/g)) {
      if (m[1].startsWith('.')) importTarget(file, m[1]);
    }
    continue;
  }
  const pre = ts.preProcessFile(code, true, true);
  for (const x of pre.importedFiles) importTarget(file, x.fileName);
  // TS preprocess covers static imports; these expressions cover workers/assets
  // and dynamic import patterns that are easy to miss in a source-only cleanup.
  for (const m of code.matchAll(/(?:\bimport\s*\(\s*|\brequire\s*\(\s*|\bnew URL\s*\(\s*)["']([^"'()]+)["']/g)) {
    importTarget(file, m[1]);
  }
  // Follow relative CSS imports and string-literal asset uses.
  for (const m of code.matchAll(/(?:from\s*|import\s*)["']([^"']+\.(?:css|svg|png|jpg|webp)(?:\?url)?)["']/g)) {
    importTarget(file, m[1]);
  }
  if (code.includes('import.meta.glob(')) {
    // Be conservative when the app uses non-literal directory imports.
    throw new Error('Manual review required for dynamic glob at ' + file);
  }
}

const forbiddenPrefixes = [
  'config/ai/', 'grasshopper/', 'supabase/', 'scripts/brep/',
  'src/server/', 'src/components/brep/', 'src/components/chat/',
];
const legacyTracked = [
  'setup.sh', '.env.local.template', 'scripts/supabase-local.sh',
  'scripts/podman/podman', 'src/routes/api/export.step.ts'
];
const forbiddenReachable = [...keep].filter(p => forbiddenPrefixes.some(prefix => p.startsWith(prefix)));
if (forbiddenReachable.length) {
  const pathTo = (file) => {
    const chain = [file];
    while (parents.has(file) && chain.length < 18) {
      file = parents.get(file);
      if (chain.includes(file)) break;
      chain.push(file);
    }
    return chain.reverse();
  };
  console.log('REACHABLE_LEGACY_FILES=' + JSON.stringify(forbiddenReachable));
  console.log('REACHABILITY_CHAINS=' + JSON.stringify(forbiddenReachable.slice(0,20).map(pathTo)));
  throw new Error('Stop before deleting required files: inspect legacy import chains');
}
const deleted = [];
for (const p of tracked) {
  let remove = false;
  if (forbiddenPrefixes.some(prefix => p.startsWith(prefix))) remove = true;
  if (legacyTracked.includes(p)) remove = true;
  if ((p.startsWith('src/') || p.startsWith('shared/')) && !keep.has(p)) remove = true;
  // Keep source tree history in Git even after removing files from this branch.
  if (remove && fs.existsSync(repoFile(p))) {
    fs.rmSync(repoFile(p), { force: true });
    deleted.push(p);
  }
}
for (const file of keep) {
  if (!fs.existsSync(repoFile(file))) {
    throw new Error('A reachable OpenSCAD file was removed: ' + file);
  }
}
const lost = [...keep].filter(p => forbiddenPrefixes.some(prefix => p.startsWith(prefix)));
if (lost.length) throw new Error('Unexpected retained legacy dependency: ' + lost.join(', '));

for (const config of ['vite.config.ts', 'eslint.config.js', 'tailwind.config.js']) {
  if (!fs.existsSync(repoFile(config))) continue;
  const source = read(config);
  const pre = ts.preProcessFile(source, true, true);
  for (const x of pre.importedFiles) externalPackage(x.fileName);
  for (const m of source.matchAll(/require\(\s*["']([^"']+)["']/g)) externalPackage(m[1]);
}
const vite = read('vite.config.ts');
const obsoleteChunkBlockStart = vite.indexOf('const aiSdkChunkTest = ');
const obsoleteChunkBlockEnd = vite.indexOf('const threeChunkTest = ', obsoleteChunkBlockStart);
if (obsoleteChunkBlockStart < 0 || obsoleteChunkBlockEnd < 0) throw new Error('Expected Vite legacy chunks missing');
let viteReduced = vite.slice(0, obsoleteChunkBlockStart) + vite.slice(obsoleteChunkBlockEnd);
const extrasStart = viteReduced.indexOf('const streamdownCoreChunkTest = ');
const extrasEnd = viteReduced.indexOf('export default defineConfig(', extrasStart);
if (extrasStart < 0 || extrasEnd < 0) throw new Error('Expected Vite legacy shiki chunks missing');
viteReduced = viteReduced.slice(0, extrasStart) + viteReduced.slice(extrasEnd);
viteReduced = viteReduced.replace(
  /(\s+\{ name: "radix-ui", test: radixChunkTest \},\n)[\s\S]*?(\s+\{ name: "three", test: threeChunkTest \},\n)/,
  '$1$2'
);
const optionalChunkLines=[
  '                { name: "streamdown-core", test: streamdownCoreChunkTest },',
  '                { name: "streamdown-cjk", test: streamdownCjkChunkTest },',
  '                { name: "streamdown-math", test: streamdownMathChunkTest },',
  '                { name: "streamdown-mermaid", test: streamdownMermaidChunkTest },',
];
for (const line of optionalChunkLines) viteReduced = viteReduced.replace(line + '\n', '');
viteReduced = viteReduced.replace(/\s+\{\s+name: "shiki",\s+test: shikiChunkTest,\s+\},\n/, '\n');
viteReduced = viteReduced.replace(/\n\s+\{\s+name: "ai-sdk",\s+test: aiSdkChunkTest,\s+\},/, '');
viteReduced = viteReduced.replace(/\n\s+\{\s+name: "supabase",\s+test: supabaseChunkTest,\s+\},/, '');
if (/aiSdkChunkTest|supabaseChunkTest|streamdownCoreChunkTest|shikiChunkTest/.test(viteReduced)) throw new Error('Unremoved Vite legacy chunk reference');
write('vite.config.ts',viteReduced);

if (fs.existsSync(repoFile('tailwind.config.js'))) {
  replace('tailwind.config.js', "    './node_modules/streamdown/dist/**/*.{js,mjs}',\n", '');
}
if (fs.existsSync(repoFile('.gitignore'))) {
  replace('.gitignore', 'supabase/.branches/\n', '');
}
if (fs.existsSync(repoFile('README.md'))) {
  let readme = read('README.md');
  readme = readme.replace(
    'One repository provides **two builds**; the local server and the free static site\nuse the same model gallery, editor, browser-side OpenSCAD WebAssembly and IndexedDB.',
    'Brepia Viewer is dedicated to **OpenSCAD only**. One codebase provides two deployment\nmethods: the free static GitHub Pages app and the optional local Node server.\nBoth run the same client-side OpenSCAD WebAssembly engine and use browser IndexedDB.'
  );
  readme = readme.replaceAll('STEP export', 'OpenSCAD export');
  readme = readme.replace(' | Available when its server-side provider is configured |', ' | Same browser-side OpenSCAD exports |');
  readme = readme.replace(' | Intentionally hidden |', ' | Same browser-side OpenSCAD exports |');
  readme = readme.replaceAll('the server-only STEP API is not shipped as an active feature of the static site.', 'no server-based CAD conversion API is required.');
  readme = readme.replaceAll('Server-backed STEP export', 'OpenSCAD export');
  write('README.md', readme);
}
if (fs.existsSync(repoFile('CHANGELOG.md'))) {
  const ch = read('CHANGELOG.md');
  write('CHANGELOG.md',
    ch.replace('# Changelog\n', '# Changelog\n\n## Unreleased — OpenSCAD-only simplification\n\n' +
      '- Removed the legacy Brepia AI, chat, BREP, Rhino/Grasshopper, Supabase, and build123d subsystems.\n' +
      '- Removed STEP export completely from both server and static builds.\n' +
      '- Kept the browser-side OpenSCAD editor, local models, model gallery, WebAssembly preview, and supported OpenSCAD export formats.\n' +
      '- Retained the optional Node server and GitHub Pages deployment with the same OpenSCAD feature set.\n\n'));
}

const manifest = JSON.parse(read('package.json'));
const usedPackageNames = new Set(packages);
const implicit = [
  'react','react-dom','typescript','vite','vitest','nitro',
  '@tanstack/react-start','@tanstack/react-router','@vitejs/plugin-react',
  'tailwindcss','autoprefixer','postcss','tailwindcss-animate',
  '@types/react','@types/react-dom','@types/node','@types/three',
  '@playwright/test','eslint','@eslint/js','typescript-eslint',
  'eslint-config-prettier','eslint-plugin-react-hooks',
  'eslint-plugin-react-refresh','globals',
  'prettier','prettier-plugin-tailwindcss','husky','lint-staged'
];
for (const name of implicit) usedPackageNames.add(name);
const noLongerUsed = Object.keys(manifest.dependencies).filter(name => !usedPackageNames.has(name));
console.log('REACHABLE_SOURCE_COUNT=' + keep.size);
console.log('REMOVED_FILE_COUNT=' + deleted.length);
console.log('REMOVED_FILE_PREFIXES=' + JSON.stringify([...new Set(deleted.map(p => p.split('/').slice(0,2).join('/')))].sort()));
console.log('REMAINING_LEGACY_IMPORTS=' + JSON.stringify(lost));
console.log('MISSING_IMPORT_TARGETS=' + JSON.stringify([...unresolved].slice(0,60)));
console.log('UNUSED_DIRECT_DEPENDENCIES=' + JSON.stringify(noLongerUsed));
if (unresolved.size > 25) throw new Error('Too many unresolved imports, abort before dependency removal');

if (noLongerUsed.length) {
  execFileSync('npm', ['uninstall', ...noLongerUsed, '--no-audit', '--no-fund', '--ignore-scripts'], {
    cwd: root, stdio: 'inherit', timeout: 180000,
  });
}
for (const obsolete of [
  '.github/scripts/one-time-open-scad-cleanup.mjs',
  '.github/workflows/one-time-open-scad-cleanup.yml'
]) {
  if (fs.existsSync(repoFile(obsolete))) fs.rmSync(repoFile(obsolete));
}
console.log('PRUNE_DONE_OPENSCAD_ONLY');
