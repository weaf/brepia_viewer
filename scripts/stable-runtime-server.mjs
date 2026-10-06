#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactRoot = process.env.BREPIA_PUBLIC_ARTIFACT_DIR?.trim()
  ? path.resolve(process.env.BREPIA_PUBLIC_ARTIFACT_DIR)
  : path.join(repositoryRoot, '.output');
const serverEntry = path.join(artifactRoot, 'nitro', 'server', 'index.mjs');

const child = spawn(process.execPath, [serverEntry], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NITRO_HOST: process.env.BREPIA_STABLE_APP_HOST || '127.0.0.1',
    NITRO_PORT: process.env.BREPIA_STABLE_APP_PORT || '3001',
  },
});

const forwardSignal = (signal) => {
  if (!child.killed) child.kill(signal);
};
process.once('SIGINT', () => forwardSignal('SIGINT'));
process.once('SIGTERM', () => forwardSignal('SIGTERM'));

child.once('error', (error) => {
  console.error(`[stable-runtime] failed to launch Nitro server: ${error.message}`);
  process.exitCode = 1;
});

child.once('exit', (code, signal) => {
  if (signal) {
    const signalNumber = { SIGINT: 2, SIGTERM: 15 }[signal] || 1;
    process.exit(128 + signalNumber);
    return;
  }
  process.exit(code ?? 1);
});
