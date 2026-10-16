#!/usr/bin/env node
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";

const publicHost = process.env.BREPIA_STABLE_HOST || "0.0.0.0";
const publicPort = Number(process.env.BREPIA_STABLE_PORT || 8005);
const appHost = process.env.BREPIA_STABLE_APP_HOST || "127.0.0.1";
const appPort = Number(process.env.BREPIA_STABLE_APP_PORT || 3001);

function proxyTarget() {
  return { host: appHost, port: appPort };
}

function forwardedHeaders(req) {
  const headers = { ...req.headers };
  const originalHost = req.headers.host;

  if (originalHost) {
    headers["x-forwarded-host"] = originalHost;
  }
  headers["x-forwarded-proto"] =
    req.headers["x-forwarded-proto"] ||
    (req.socket.encrypted ? "https" : "http");

  const remoteAddress = req.socket.remoteAddress;
  if (remoteAddress) {
    const existing = req.headers["x-forwarded-for"];
    headers["x-forwarded-for"] = existing
      ? `${existing}, ${remoteAddress}`
      : remoteAddress;
  }

  return headers;
}

function handleHttp(req, res) {
  const target = proxyTarget(req.url);
  const upstream = http.request(
    {
      hostname: target.host,
      port: target.port,
      path: req.url,
      method: req.method,
      headers: forwardedHeaders(req),
    },
    (upstreamRes) => {
      if (res.destroyed || res.writableEnded) {
        upstreamRes.destroy();
        return;
      }

      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );

  const closeUpstream = () => {
    if (!upstream.destroyed) upstream.destroy();
  };

  req.on("aborted", closeUpstream);
  res.on("close", () => {
    if (!res.writableEnded) closeUpstream();
  });

  upstream.on("error", (error) => {
    if (res.destroyed || res.writableEnded) return;
    console.error(
      `[stable-proxy] ${req.method || "GET"} ${req.url || "/"} -> ${target.host}:${target.port}: ${error.message}`,
    );
    res.statusCode = 502;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Stable runtime upstream unavailable");
  });

  req.pipe(upstream);
}

function handleUpgrade(req, socket, head) {
  const target = proxyTarget(req.url);

  // Stable mode has no Vite development/HMR websocket. Forward app websocket
  // upgrades directly to the generated server.
  const upstream = net.connect(target.port, target.host, () => {
    const headers = forwardedHeaders(req);
    const requestLine = `${req.method || "GET"} ${req.url || "/"} HTTP/${req.httpVersion}\r\n`;
    const headerLines = Object.entries(headers)
      .flatMap(([name, value]) => {
        if (Array.isArray(value)) {
          return value.map((item) => `${name}: ${item}\r\n`);
        }
        return value === undefined ? [] : [`${name}: ${value}\r\n`];
      })
      .join("");

    upstream.write(`${requestLine}${headerLines}\r\n`);
    if (head.length > 0) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });

  const closeBoth = () => {
    if (!socket.destroyed) socket.destroy();
    if (!upstream.destroyed) upstream.destroy();
  };

  upstream.on("error", (error) => {
    if (error.code !== "ECONNRESET") {
      console.warn(
        `[stable-proxy] websocket ${req.url || "/"} -> ${target.host}:${target.port}: ${error.message}`,
      );
    }
    closeBoth();
  });
  socket.on("error", closeBoth);
}

function waitForPort(host, port, timeoutMs = 20000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect(port, host);
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - startedAt >= timeoutMs) {
          reject(
            new Error(
              `Stable app did not listen on ${host}:${port} within ${timeoutMs}ms`,
            ),
          );
          return;
        }
        setTimeout(attempt, 250);
      });
    };

    attempt();
  });
}

let server;
let shuttingDown = false;
let appExited = false;

// Run the generated Nitro node-server artifact directly. `vite preview` is a
// Vite development tool that is not the application server for Nitro's
// completed node-server build and can remain orphaned without ever exposing
// the built application in a clean exported tree.
const nodeCommand = process.execPath;
const serverLauncher = new URL("./stable-runtime-server.mjs", import.meta.url);
const app = spawn(nodeCommand, [serverLauncher.pathname], {
  stdio: "inherit",
  env: process.env,
});

app.once("exit", (code, signal) => {
  appExited = true;
  if (shuttingDown) return;
  console.error(
    `[stable-runtime] production preview exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "none"})`,
  );
  process.exitCode = code || 1;
  if (server) {
    server.close(() => process.exit(process.exitCode || 1));
  } else {
    process.exit(process.exitCode || 1);
  }
});

try {
  await waitForPort(appHost, appPort);
} catch (error) {
  console.error(`[stable-runtime] ${error.message}`);
  if (!appExited) app.kill("SIGTERM");
  process.exit(1);
}

server = http.createServer(handleHttp);
server.on("upgrade", handleUpgrade);
server.on("clientError", (error, socket) => {
  if (error.code !== "ECONNRESET") {
    console.warn(`[stable-proxy] client error: ${error.message}`);
  }
  if (!socket.destroyed) socket.destroy();
});
server.on("error", (error) => {
  console.error(`[stable-proxy] failed to listen: ${error.message}`);
  if (!appExited) app.kill("SIGTERM");
  process.exit(1);
});

server.listen(publicPort, publicHost, () => {
  console.log(
    `[stable-runtime] http://${publicHost}:${publicPort} -> app http://${appHost}:${appPort}`,
  );
});

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[stable-runtime] ${signal}, shutting down`);

  if (!appExited) app.kill("SIGTERM");
  if (server) {
    server.close(() => process.exit(0));
  } else {
    process.exit(0);
  }

  setTimeout(() => {
    if (!appExited) app.kill("SIGKILL");
    process.exit(0);
  }, 2500).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
