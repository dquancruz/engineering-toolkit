import type { Evaluation, RegexRequest } from "./regex.js";

export const TIMEOUT_MS = 1500;

/** The part of a Worker the runner uses (tests pass a fake). */
export interface RegexWorker {
  postMessage(message: RegexRequest): void;
  terminate(): void;
  onmessage: ((event: { data: Evaluation }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
}

export type Outcome =
  | Evaluation
  | { ok: false; timeout: true }
  | { ok: false; superseded: true }
  /** The worker could not run at all (not a problem with the pattern). */
  | { ok: false; failed: string };

/**
 * Evaluates in a worker with a time limit. A worker that exceeds it, or is still busy when a newer request
 * arrives, is terminated: there is no other way to stop a running regular expression.
 */
export function createRunner(spawn: () => RegexWorker, timeoutMs = TIMEOUT_MS) {
  let idle: RegexWorker | null = null;
  let cancel: (() => void) | null = null;

  return {
    run(request: RegexRequest): Promise<Outcome> {
      cancel?.();
      const worker = idle ?? spawn();
      idle = null;
      return new Promise<Outcome>((resolve) => {
        const finish = (outcome: Outcome, keep: boolean) => {
          clearTimeout(timer);
          cancel = null;
          worker.onmessage = worker.onerror = null;
          if (keep) idle = worker;
          else worker.terminate();
          resolve(outcome);
        };
        const timer = setTimeout(() => finish({ ok: false, timeout: true }, false), timeoutMs);
        cancel = () => finish({ ok: false, superseded: true }, false);
        worker.onmessage = (event) => finish(event.data, true);
        worker.onerror = (event) => finish({ ok: false, failed: event.message ?? "Worker error" }, false);
        worker.postMessage(request);
      });
    },
  };
}
