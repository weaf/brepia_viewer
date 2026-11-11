import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenScadTimeoutError } from '@/lib/openScadTimeoutError';
import { OpenScadWorkerClient } from './openScadWorkerClient';
import type { WorkerMessage } from './types';

type OnEvent = (event: { data?: unknown }) => void;

class MockWorker {
  readonly listeners = new Map<string, Set<OnEvent>>();
  readonly sent: unknown[] = [];
  terminated = false;
  addEventListener(type: string, fn: OnEvent) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(fn);
  }
  removeEventListener(type: string, fn: OnEvent) {
    this.listeners.get(type)?.delete(fn);
  }
  postMessage(message: unknown) { this.sent.push(message); }
  terminate() { this.terminated = true; }
  respond(id: string, data: unknown) {
    for (const fn of this.listeners.get('message') ?? []) fn({ data: { id, data } });
  }
}

const message = (id: string) => ({
  id,
  type: 'preview',
  data: { project: null, params: [], fileType: 'stl' },
}) as unknown as WorkerMessage & { id: string };

afterEach(() => vi.useRealTimers());

describe('OpenScadWorkerClient timeout recovery', () => {
  it('rejects a cancelled request, ignores its late response and recovers', async () => {
    const workers: MockWorker[] = [];
    const client = new OpenScadWorkerClient(() => {
      const worker = new MockWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    });
    const oldRequest = client.request(message('cancelled'));
    const aborted = expect(oldRequest).rejects.toThrow('Preview cancelled');
    expect(client.pendingCount()).toBe(1);

    client.reset(new Error('Preview cancelled'));
    await aborted;
    expect(workers[0].terminated).toBe(true);
    expect(client.pendingCount()).toBe(0);
    expect(client.getGeneration()).toBe(1);

    // A stale reply cannot satisfy a new request created by the new worker.
    const fresh = client.request(message('new-preview'));
    workers[0].respond('cancelled', { stale: true });
    expect(client.pendingCount()).toBe(1);
    workers[1].respond('new-preview', { current: true });
    await expect(fresh).resolves.toEqual({ current: true });
    expect(client.pendingCount()).toBe(0);
    client.reset();
  });

  it('terminates stale worker and accepts a new request on a fresh worker', async () => {
    vi.useFakeTimers();
    const workers: MockWorker[] = [];
    const client = new OpenScadWorkerClient(() => {
      const worker = new MockWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    });
    const first = client.request(message('first'), [], 10);
    const rejection = expect(first).rejects.toBeInstanceOf(OpenScadTimeoutError);
    await vi.advanceTimersByTimeAsync(10);
    await rejection;
    expect(workers[0].terminated).toBe(true);
    expect(client.pendingCount()).toBe(0);
    expect(client.hasWorker()).toBe(false);
    expect(client.getGeneration()).toBe(1);

    const second = client.request(message('second'), [], 10);
    expect(workers).toHaveLength(2);
    workers[1].respond('second', { success: true });
    await expect(second).resolves.toEqual({ success: true });
    expect(client.pendingCount()).toBe(0);
    client.reset();
  });
});
