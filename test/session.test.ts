import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  decodeJwtPayload,
  getProsperoSessionStatus,
  loadProsperoSessionState,
  resolveProsperoSessionStatePath,
  saveProsperoSessionState,
} from "../src/prospero-browser.js";

test("session state round-trips without storing the raw token", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "prospero-session-test-"));
  const previous = process.env.PROSPERO_USER_DATA_DIR;
  process.env.PROSPERO_USER_DATA_DIR = directory;

  try {
    const token = makeJwt({ useruuid: "test-user", iat: 1_700_000_000, exp: 4_102_444_800 });
    const user = JSON.stringify({ useruuid: "test-user", role: "reviewer" });
    saveProsperoSessionState(token, user);

    const stored = readFileSync(resolveProsperoSessionStatePath(), "utf8");
    assert.equal(stored.includes(token), false);
    assert.deepEqual(loadProsperoSessionState(), {
      token,
      user,
      captured_at: getProsperoSessionStatus().captured_at,
    });
    const status = getProsperoSessionStatus(new Date("2026-01-01T00:00:00Z"));
    assert.equal(status.state, "present");
    assert.equal(status.user_identity_present, true);
    assert.equal(status.protection, process.platform === "win32" ? "windows-dpapi" : "file-permissions");
  } finally {
    if (previous === undefined) delete process.env.PROSPERO_USER_DATA_DIR;
    else process.env.PROSPERO_USER_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("decodeJwtPayload returns null for invalid tokens", () => {
  assert.equal(decodeJwtPayload("not-a-jwt"), null);
});

function makeJwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.signature`;
}
