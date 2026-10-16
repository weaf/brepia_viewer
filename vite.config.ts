import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import fs from "node:fs";
import path from "path";
import http from "node:http";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const appBase = "/";
const stableArtifactDir = (
  process.env.BREPIA_PUBLIC_ARTIFACT_DIR ||
  process.env.BREPIA_PUBLIC_ARTIFACT_DIR
)?.trim();
const requestedPort = Number(process.env.BREPIA_VIEWER_PORT || 8005);
const vitePort = Number.isInteger(requestedPort) && requestedPort >= 1 && requestedPort <= 65535
  ? requestedPort
  : 8005;

function serveOpenScadWasm(): Plugin {
  const wasmPath = path.resolve(
    import.meta.dirname,
    "src/vendor/openscad-wasm/openscad.wasm",
  );

  const installMiddleware = (server: {
    middlewares: {
      use: (
        handler: (
          req: http.IncomingMessage,
          res: http.ServerResponse,
          next: (error?: unknown) => void,
        ) => void,
      ) => void;
    };
  }) => {
    server.middlewares.use((req, res, next) => {
      if (!req.url) return next();

      const url = new URL(req.url, "http://localhost");
      if (
        url.searchParams.has("import") ||
        url.searchParams.has("url") ||
        !url.pathname.endsWith("/openscad.wasm")
      ) {
        return next();
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/wasm");
      res.setHeader("Cache-Control", "no-cache");
      fs.createReadStream(wasmPath)
        .on("error", (error) => next(error))
        .pipe(res);
    });
  };

  return {
    name: "serve-openscad-wasm",
    configureServer(server) {
      installMiddleware(server);
    },
    configurePreviewServer(server) {
      installMiddleware(server);
    },
  };
}

const vendorChunkTest = (id: string) =>
  id.includes("/node_modules/react/") ||
  id.includes("/node_modules/react-dom/") ||
  id.includes("/node_modules/@tanstack/react-router/") ||
  id.includes("/node_modules/@tanstack/react-start/") ||
  id.includes("/node_modules/lucide-react/");

const radixChunkTest = (id: string) => id.includes("/node_modules/@radix-ui/");

const aiSdkChunkTest = (id: string) =>
  id.includes("/node_modules/ai/") || id.includes("/node_modules/@ai-sdk/");

const supabaseChunkTest = (id: string) =>
  id.includes("/node_modules/@supabase/");

const threeChunkTest = (id: string) => id.includes("/node_modules/three/");

const reactThreeChunkTest = (id: string) =>
  id.includes("/node_modules/@react-three/") ||
  id.includes("/node_modules/three-stdlib/");

const streamdownCoreChunkTest = (id: string) =>
  id.includes("/node_modules/streamdown/");

const streamdownCjkChunkTest = (id: string) =>
  id.includes("/node_modules/@streamdown/cjk/");

const streamdownMathChunkTest = (id: string) =>
  id.includes("/node_modules/@streamdown/math/") ||
  id.includes("/node_modules/katex/");

const streamdownMermaidChunkTest = (id: string) =>
  id.includes("/node_modules/@streamdown/mermaid/");

const shikiChunkTest = (id: string) =>
  id.includes("/node_modules/shiki/dist/") ||
  id.includes("/node_modules/@shikijs/core/") ||
  id.includes("/node_modules/@shikijs/engine-javascript/");

export default defineConfig({
  base: appBase,
  plugins: [
    serveOpenScadWasm(),
    tanstackStart({
      router: {
        basepath: appBase,
        semicolons: true,
      },
      spa: {
        enabled: true,
        maskPath: appBase,
      },
    }),
    nitro({
      baseURL: appBase,
      inlineDynamicImports: true,
      routeRules: {
        "/**": {
          headers: {
            "Content-Security-Policy":
              "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https: wss:; worker-src 'self' blob:; manifest-src 'self'",
            "Permissions-Policy":
              "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
            "Referrer-Policy": "strict-origin-when-cross-origin",
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
          },
        },
      },
      output: stableArtifactDir
        ? { dir: path.join(stableArtifactDir, "nitro") }
        : undefined,
    }),
    react(),
  ],
  resolve: {
    alias: {
      "@/vendor/openscad-wasm/openscad.js": path.resolve(
        import.meta.dirname,
        "./src/vendor/openscad-wasm/runtime.ts",
      ),
      "@": path.resolve(import.meta.dirname, "./src"),
      "@shared": path.resolve(import.meta.dirname, "./shared"),
    },
  },
  build: {
    chunkSizeWarningLimit: 1000,

    outDir: "dist/brepia",
    emptyOutDir: true,

    sourcemap: true,
  },
  environments: {
    client: {
      build: {
        outDir: "dist/brepia",
        rolldownOptions: {
          output: {
            codeSplitting: {
              groups: [
                { name: "vendor", test: vendorChunkTest },
                { name: "radix-ui", test: radixChunkTest },
                { name: "ai-sdk", test: aiSdkChunkTest },
                { name: "supabase", test: supabaseChunkTest },
                { name: "three", test: threeChunkTest },
                { name: "react-three", test: reactThreeChunkTest },
                { name: "streamdown-core", test: streamdownCoreChunkTest },
                { name: "streamdown-cjk", test: streamdownCjkChunkTest },
                { name: "streamdown-math", test: streamdownMathChunkTest },
                {
                  name: "streamdown-mermaid",
                  test: streamdownMermaidChunkTest,
                },
                { name: "shiki", test: shikiChunkTest },
              ],
            },
          },
        },
      },
    },
    server: {
      build: {
        outDir: "dist/server",
      },
    },
  },
  preview: {
    port: vitePort,
    strictPort: false,
    host: true,
  },
  server: {
    port: vitePort,
    strictPort: false,
    open: false,
    host: true,
    allowedHosts: ["alpine.0r4cl3.se", "db.noty.se"],
  },
  optimizeDeps: {
    exclude: ["@zip.js/zip.js", "three", "three-stdlib"],
  },
});
