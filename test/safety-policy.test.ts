import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ProsperoError } from "../src/errors.js";
import { assertAllowedOutputPath, assertAllowedProtocolPath, assertExternalNetworkAllowed, scanOutboundText } from "../src/safety-policy.js";

test("privacy scan catches identifiers but permits public registry identifiers", () => {
  assert.equal(scanOutboundText("breast cancer CRD420251181863").length, 0);
  assert.equal(scanOutboundText("contact researcher@example.org").some((item) => item.type === "email"), true);
  assert.equal(scanOutboundText("MRN: A123456").some((item) => item.type === "clinical_identifier"), true);
});

test("offline mode fails closed before external network access", () => {
  const previous = process.env.PROSPERO_NETWORK_MODE;
  process.env.PROSPERO_NETWORK_MODE = "offline";
  try {
    assert.throws(() => assertExternalNetworkAllowed("pubmed"), (error: unknown) => error instanceof ProsperoError);
  } finally {
    if (previous === undefined) delete process.env.PROSPERO_NETWORK_MODE; else process.env.PROSPERO_NETWORK_MODE = previous;
  }
});

test("protocol and output paths are constrained to configured roots", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "prospero-safe-root-"));
  const outside = mkdtempSync(path.join(os.tmpdir(), "prospero-outside-"));
  const protocol = path.join(root, "protocol.md");
  writeFileSync(protocol, "# Review title\nSafe review protocol");
  const oldProtocol = process.env.PROSPERO_ALLOWED_PROTOCOL_DIRS;
  const oldOutput = process.env.PROSPERO_ALLOWED_OUTPUT_DIRS;
  process.env.PROSPERO_ALLOWED_PROTOCOL_DIRS = root;
  process.env.PROSPERO_ALLOWED_OUTPUT_DIRS = root;
  try {
    assert.equal(assertAllowedProtocolPath(protocol), protocol);
    assert.equal(assertAllowedOutputPath(path.join(root, "preview.html")), path.join(root, "preview.html"));
    assert.throws(() => assertAllowedOutputPath(path.join(outside, "preview.html")), (error: unknown) => error instanceof ProsperoError);
  } finally {
    if (oldProtocol === undefined) delete process.env.PROSPERO_ALLOWED_PROTOCOL_DIRS; else process.env.PROSPERO_ALLOWED_PROTOCOL_DIRS = oldProtocol;
    if (oldOutput === undefined) delete process.env.PROSPERO_ALLOWED_OUTPUT_DIRS; else process.env.PROSPERO_ALLOWED_OUTPUT_DIRS = oldOutput;
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
