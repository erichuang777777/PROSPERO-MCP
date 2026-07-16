import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { cacheKey, readPublicCache, writePublicCache } from "../src/public-cache.js";

test("public cache uses deterministic keys and supports explicit stale reads", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "prospero-cache-"));
  const oldDir = process.env.PROSPERO_CACHE_DIR;
  const oldTtl = process.env.PROSPERO_CACHE_TTL_MS;
  process.env.PROSPERO_CACHE_DIR = root;
  process.env.PROSPERO_CACHE_TTL_MS = "10000";
  try {
    const key = cacheKey({ query: "breast cancer", page: 1 });
    assert.equal(key, cacheKey({ page: 1, query: "breast cancer" }));
    writePublicCache("test", key, { public_id: "CRD1" });
    const fresh = readPublicCache<{ public_id: string }>("test", key);
    assert.equal(fresh?.data.public_id, "CRD1");
    process.env.PROSPERO_CACHE_TTL_MS = "1";
    const start = Date.now(); while (Date.now() - start < 5) { /* ensure TTL expires */ }
    assert.equal(readPublicCache("test", key), undefined);
    assert.equal(readPublicCache<{ public_id: string }>("test", key, true)?.stale, true);
  } finally {
    if (oldDir === undefined) delete process.env.PROSPERO_CACHE_DIR; else process.env.PROSPERO_CACHE_DIR = oldDir;
    if (oldTtl === undefined) delete process.env.PROSPERO_CACHE_TTL_MS; else process.env.PROSPERO_CACHE_TTL_MS = oldTtl;
    rmSync(root, { recursive: true, force: true });
  }
});
