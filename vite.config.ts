import { sentryVitePlugin } from '@sentry/vite-plugin';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { nitro } from 'nitro/vite';
import fs from 'node:fs';
import http from 'node:http';
import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const appBase = '/';
const stableArtifactDir = (
  process.env.BREPIA_PUBLIC_ARTIFACT_DIR ||
  process.env.BREPIA_PUBLIC_ARTIFACT_DIR
)?.trim();
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN?.trim();
const configuredVitePort = Number(
  process.env.BREPIA_PORT ?? process.env.PORT ?? 3000,
);
const vitePort =
  Number.isInteger(configuredVitePort) &&
  configuredVitePort > 0 &&
  configuredVitePort < 65536
    ? configuredVitePort
    : 3000;

function supabaseProxyPlugin(): Plugin {
  return {
    name: 'supabase-proxy',
    configureServer(server) {
      const rawTarget = process.env.VITE_SUPABASE_URL?.trim();
      const target = rawTarget ? new URL(rawTarget) : null;
      if (target && target.protocol !== 'http:') {
        throw new Error(
          'Local Supabase proxy requires an http:// VITE_SUPABASE_URL',
        );
      }
      const agent = new http.Agent({ keepAlive: true });
      server.middlewares.use((req, res, next) => {
        if (!req.url) return next();
        if (
          !req.url.startsWith('/auth') &&
          !req.url.startsWith('/rest') &&
          !req.url.startsWith('/storage')
        ) {
          return next();
        }

        const targetPath = req.url;
        const bodyChunks: Buffer[] = [];
        req.on('data', (chunk) => bodyChunks.push(chunk));
        req.on('end', () => {
          const body = Buffer.concat(bodyChunks);
          const options = {
            hostname: target?.hostname ?? '127.0.0.1',
            port: Number(target?.port || 80),
            path: targetPath,
            method: req.method,
            headers: {
              ...req.headers,
              host: target?.host ?? '127.0.0.1',
              connection: 'keep-alive',
            },
            agent,
            timeout: 30000,
          };
          const proxyReq = http.request(options, (proxyRes) => {
            const statusCode = proxyRes.statusCode ?? 502;
            const chunks: Buffer[] = [];
            proxyRes.on('data', (chunk) => chunks.push(chunk));
            proxyRes.on('end', () => {
              if (res.destroyed || res.writableEnded) return;
              const responseBody = Buffer.concat(chunks);
              res.writeHead(statusCode, proxyRes.headers);
              res.end(responseBody);
            });
          });
          proxyReq.on('timeout', () => {
            proxyReq.destroy();
            if (res.destroyed || res.writableEnded) return;
            res.statusCode = 504;
            res.end('Supabase proxy timeout');
          });
          proxyReq.on('error', (err) => {
            if (res.destroyed || res.writableEnded) return;
            console.error(
              '[supabase-proxy]',
              req.method,
              targetPath,
              err.message,
            );
            res.statusCode = 502;
            res.end(`Supabase proxy error: ${err.message}`);
          });
          if (body.length > 0) proxyReq.write(body);
          proxyReq.end();
        });
      });
    },
  };
}

function serveOpenScadWasm(): Plugin {
  const wasmPath = path.resolve(
    import.meta.dirname,
    'src/vendor/openscad-wasm/openscad.wasm',
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

      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.endsWith('/openscad.wasm')) {
        return next();
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/wasm');
      res.setHeader('Cache-Control', 'no-cache');
      fs.createReadStream(wasmPath)
        .on('error', (error) => next(error))
        .pipe(res);
    });
  };

  return {
    name: 'serve-openscad-wasm',
    configureServer(server) {
      installMiddleware(server);
    },
    configurePreviewServer(server) {
      installMiddleware(server);
    },
  };
}

const vendorChunkTest = (id: string) =>
  id.includes('/node_modules/react/') ||
  id.includes('/node_modules/react-dom/') ||
  id.includes('/node_modules/@tanstack/react-router/') ||
  id.includes('/node_modules/@tanstack/react-start/') ||
  id.includes('/node_modules/lucide-react/');

const radixChunkTest = (id: string) => id.includes('/node_modules/@radix-ui/');

const aiSdkChunkTest = (id: string) =>
  id.includes('/node_modules/ai/') || id.includes('/node_modules/@ai-sdk/');

const supabaseChunkTest = (id: string) =>
  id.includes('/node_modules/@supabase/');

const threeChunkTest = (id: string) => id.includes('/node_modules/three/');

const reactThreeChunkTest = (id: string) =>
  id.includes('/node_modules/@react-three/') ||
  id.includes('/node_modules/three-stdlib/');

const streamdownCoreChunkTest = (id: string) =>
  id.includes('/node_modules/streamdown/');

const streamdownCjkChunkTest = (id: string) =>
  id.includes('/node_modules/@streamdown/cjk/');

const streamdownMathChunkTest = (id: string) =>
  id.includes('/node_modules/@streamdown/math/') ||
  id.includes('/node_modules/katex/');

const streamdownMermaidChunkTest = (id: string) =>
  id.includes('/node_modules/@streamdown/mermaid/');

const shikiChunkTest = (id: string) =>
  id.includes('/node_modules/shiki/dist/') ||
  id.includes('/node_modules/@shikijs/core/') ||
  id.includes('/node_modules/@shikijs/engine-javascript/');

export default defineConfig({
  base: appBase,
  plugins: [
    serveOpenScadWasm(),
    supabaseProxyPlugin(),
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
        '/**': {
          headers: {
            'Content-Security-Policy':
              "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https: wss:; worker-src 'self' blob:; manifest-src 'self'",
            'Permissions-Policy':
              'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
            'Referrer-Policy': 'strict-origin-when-cross-origin',
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
          },
        },
      },
      output: stableArtifactDir
        ? { dir: path.join(stableArtifactDir, 'nitro') }
        : undefined,
    }),
    react(),
    sentryAuthToken
      ? sentryVitePlugin({
          org: 'adamcad',
          project: 'adamcad',
          authToken: sentryAuthToken,
        })
      : null,
  ],
  resolve: {
    alias: {
      '@/vendor/openscad-wasm/openscad.js': path.resolve(
        import.meta.dirname,
        './src/vendor/openscad-wasm/runtime.ts',
      ),
      '@': path.resolve(import.meta.dirname, './src'),
      '@shared': path.resolve(import.meta.dirname, './shared'),
    },
  },
  build: {
    chunkSizeWarningLimit: 1000,

    outDir: 'dist/brepia',
    emptyOutDir: true,

    sourcemap: true,
  },
  environments: {
    client: {
      build: {
        outDir: 'dist/brepia',
        rolldownOptions: {
          output: {
            codeSplitting: {
              groups: [
                { name: 'vendor', test: vendorChunkTest },
                { name: 'radix-ui', test: radixChunkTest },
                { name: 'ai-sdk', test: aiSdkChunkTest },
                { name: 'supabase', test: supabaseChunkTest },
                { name: 'three', test: threeChunkTest },
                { name: 'react-three', test: reactThreeChunkTest },
                { name: 'streamdown-core', test: streamdownCoreChunkTest },
                { name: 'streamdown-cjk', test: streamdownCjkChunkTest },
                { name: 'streamdown-math', test: streamdownMathChunkTest },
                {
                  name: 'streamdown-mermaid',
                  test: streamdownMermaidChunkTest,
                },
                { name: 'shiki', test: shikiChunkTest },
              ],
            },
          },
        },
      },
    },
    server: {
      build: {
        outDir: 'dist/server',
      },
    },
  },
  preview: {
    port: 4173,
    host: true,
  },
  server: {
    port: vitePort,
    open: false,
    host: true,
    allowedHosts: ['alpine.0r4cl3.se', 'db.noty.se'],
  },
  optimizeDeps: {
    exclude: ['@zip.js/zip.js', 'three', 'three-stdlib', '@sentry/vite-plugin'],
  },
});
