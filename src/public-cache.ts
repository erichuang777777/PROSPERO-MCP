import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { atomicWriteFileSync } from "./atomic-file.js";

interface CacheEnvelope<T> { version: 1; created_at: string; data: T; }

export function cacheKey(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function readPublicCache<T>(namespace: string, key: string, allowStale = false): { data: T; stale: boolean; created_at: string } | undefined {
  if (process.env.PROSPERO_CACHE_ENABLED === "false") return undefined;
  const target = cachePath(namespace, key);
  if (!existsSync(target)) return undefined;
  try {
    const envelope = JSON.parse(readFileSync(target, "utf8")) as CacheEnvelope<T>;
    if (envelope.version !== 1) return undefined;
    const stale = Date.now() - Date.parse(envelope.created_at) > readPositive(process.env.PROSPERO_CACHE_TTL_MS, 21_600_000);
    return stale && !allowStale ? undefined : { data: envelope.data, stale, created_at: envelope.created_at };
  } catch { return undefined; }
}

export function writePublicCache<T>(namespace: string, key: string, data: T): void {
  if (process.env.PROSPERO_CACHE_ENABLED === "false") return;
  const envelope: CacheEnvelope<T> = { version: 1, created_at: new Date().toISOString(), data };
  atomicWriteFileSync(cachePath(namespace, key), `${JSON.stringify(envelope)}\n`, { encoding: "utf8" });
}

function cachePath(namespace: string, key: string): string {
  return path.resolve(process.env.PROSPERO_CACHE_DIR ?? ".prospero-cache", namespace, `${key}.json`);
}
function readPositive(value: string | undefined, fallback: number): number { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback; }
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") { const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`; }
  return JSON.stringify(value);
}
