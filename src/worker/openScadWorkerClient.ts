import { OPENSCAD_COMPILE_TIMEOUT_MS } from '@/lib/openScadLimits';
import type { OpenSCADWorkerResponseData, WorkerMessage } from '@/worker/types';
import { errorFromWorker } from '@/worker/workerError';

type TimeoutHandle = ReturnType<typeof globalThis.setTimeout>;

type PendingRequest<T> = {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timeoutId: TimeoutHandle;
};

type WorkerFactory = () => Worker;

export class OpenScadWorkerClient {
  private worker: Worker | null = null;
  private readonly pending = new Map<string, PendingRequest<unknown>>();
  private generation = 0;

  constructor(private readonly createWorker: WorkerFactory) {}

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    const worker = this.createWorker();
    worker.addEventListener('message', this.handleMessage);
    worker.addEventListener('error', this.handleCrash);
    worker.addEventListener('messageerror', this.handleMessageError);
    this.worker = worker;
    return worker;
  }

  private readonly handleMessage = (event: MessageEvent) => {
    const { id, err } = event.data ?? {};
    if (!id) return;

    const key = String(id);
    const request = this.pending.get(key);
    if (!request) return;

    this.pending.delete(key);
    globalThis.clearTimeout(request.timeoutId);

    if (err) {
      request.reject(errorFromWorker(err));
      return;
    }

    request.resolve(event.data.data);
  };

  private readonly handleCrash = (event: ErrorEvent) => {
    this.reset(new Error(event.message || 'OpenSCAD worker error'));
  };

  private readonly handleMessageError = () => {
    this.reset(new Error('OpenSCAD worker message error'));
  };

  request<T = OpenSCADWorkerResponseData>(
    message: WorkerMessage & { id: string },
    transfer: Transferable[] = [],
    timeoutMs = OPENSCAD_COMPILE_TIMEOUT_MS,
  ): Promise<T> {
    const worker = this.ensureWorker();

    return new Promise<T>((resolve, reject) => {
      const timeoutId = globalThis.setTimeout(() => {
        this.reset(
          new Error(`OpenSCAD worker timed out after ${timeoutMs} ms.`),
        );
      }, timeoutMs);

      this.pending.set(message.id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeoutId,
      });

      try {
        worker.postMessage(message, transfer);
      } catch (error) {
        this.reset(
          error instanceof Error
            ? error
            : new Error('Failed to post message to OpenSCAD worker'),
        );
      }
    });
  }

  reset(error = new Error('OpenSCAD worker terminated')): void {
    const worker = this.worker;
    this.worker = null;

    if (worker) {
      worker.removeEventListener('message', this.handleMessage);
      worker.removeEventListener('error', this.handleCrash);
      worker.removeEventListener('messageerror', this.handleMessageError);
      worker.terminate();
    }

    for (const request of this.pending.values()) {
      globalThis.clearTimeout(request.timeoutId);
      request.reject(error);
    }
    this.pending.clear();
    this.generation += 1;
  }

  hasWorker(): boolean {
    return this.worker !== null;
  }

  pendingCount(): number {
    return this.pending.size;
  }

  getGeneration(): number {
    return this.generation;
  }
}
