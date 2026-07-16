import { normalizeProsperoError } from "./errors.js";

export interface RetryOptions {
  attempts?: number;
  delays_ms?: number[];
  on_retry?: ((error: Error, attempt: number, delayMs: number) => void) | undefined;
}

export async function withRetry<T>(operation: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, Math.trunc(options.attempts ?? 3));
  const delays = options.delays_ms ?? [350, 1_000, 2_000];

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      const normalized = normalizeProsperoError(error);
      if (!normalized.retryable || attempt >= attempts) throw normalized;
      const delayMs = delays[Math.min(attempt - 1, delays.length - 1)] ?? 1_000;
      options.on_retry?.(normalized, attempt, delayMs);
      await delay(delayMs);
    }
  }

  throw new Error("Retry loop exited unexpectedly");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
