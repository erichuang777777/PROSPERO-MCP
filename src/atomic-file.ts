import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { ProsperoError } from "./errors.js";

export function atomicWriteFileSync(target: string, data: string | Buffer, options: { encoding?: BufferEncoding; mode?: number } = {}): void {
  const directory = path.dirname(target);
  mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(target)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    // Write, flush to disk, then rename so a crash can never atomically publish a truncated file.
    const descriptor = openSync(temporary, "wx", options.mode ?? 0o600);
    try {
      writeSync(descriptor, typeof data === "string" ? Buffer.from(data, options.encoding ?? "utf8") : data);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, target);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}

export async function withFileLock<T>(lockPath: string, operation: () => Promise<T>, staleMs = 120_000): Promise<T> {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  let descriptor: number | undefined;
  for (let attempt = 0; attempt < 3 && descriptor === undefined; attempt += 1) {
    try {
      descriptor = openSync(lockPath, "wx", 0o600);
    } catch (error) {
      // Only reclaim a lock that is still the exact stale file we observed. Re-checking the
      // mtime immediately before removal prevents deleting a lock another process just took.
      const observed = statSync(lockPath, { throwIfNoEntry: false });
      const stale = observed !== undefined && Date.now() - observed.mtimeMs > staleMs;
      if (attempt < 2 && stale) {
        const current = statSync(lockPath, { throwIfNoEntry: false });
        if (current !== undefined && current.mtimeMs === observed.mtimeMs && Date.now() - current.mtimeMs > staleMs) {
          rmSync(lockPath, { force: true });
        }
        continue;
      }
      throw new ProsperoError({ code: "WRITE_CONFIRMATION_REQUIRED", message: "Another operation currently holds this draft lock.", retryable: true, action: "Wait for it to finish, then verify the live state again." }, { cause: error });
    }
  }
  if (descriptor === undefined) {
    throw new ProsperoError({ code: "WRITE_CONFIRMATION_REQUIRED", message: "Another operation currently holds this draft lock.", retryable: true, action: "Wait for it to finish, then verify the live state again." });
  }
  writeSync(descriptor, JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }));
  try { return await operation(); }
  finally {
    closeSync(descriptor);
    rmSync(lockPath, { force: true });
  }
}
