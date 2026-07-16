import { closeSync, existsSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { ProsperoError } from "./errors.js";

export function atomicWriteFileSync(target: string, data: string | Buffer, options: { encoding?: BufferEncoding; mode?: number } = {}): void {
  const directory = path.dirname(target);
  mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(target)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(temporary, data, { encoding: options.encoding, mode: options.mode ?? 0o600, flag: "wx" });
    renameSync(temporary, target);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}

export async function withFileLock<T>(lockPath: string, operation: () => Promise<T>, staleMs = 120_000): Promise<T> {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  let descriptor: number | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      descriptor = openSync(lockPath, "wx", 0o600);
      writeFileSync(descriptor, JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }));
      break;
    } catch (error) {
      if (attempt === 0 && existsSync(lockPath) && Date.now() - statSync(lockPath).mtimeMs > staleMs) {
        rmSync(lockPath, { force: true });
        continue;
      }
      throw new ProsperoError({ code: "WRITE_CONFIRMATION_REQUIRED", message: "Another operation currently holds this draft lock.", retryable: true, action: "Wait for it to finish, then verify the live state again." }, { cause: error });
    }
  }
  try { return await operation(); }
  finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(lockPath, { force: true });
  }
}
