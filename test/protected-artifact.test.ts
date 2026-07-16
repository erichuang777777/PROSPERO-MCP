import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { prepareProtectedArtifactRead, protectLocalArtifact, readProtectedLocalArtifact } from "../src/protected-artifact.js";

test("protected local artifact round-trips without plaintext in envelope", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "prospero-protected-"));
  const input = path.join(root, "workbook.md");
  const output = path.join(root, "workbook.protected.json");
  const secretText = "Confidential systematic review protocol content";
  writeFileSync(input, secretText);
  const oldProtocol = process.env.PROSPERO_ALLOWED_PROTOCOL_DIRS;
  const oldOutput = process.env.PROSPERO_ALLOWED_OUTPUT_DIRS;
  const oldKey = process.env.PROSPERO_ARTIFACT_KEY;
  process.env.PROSPERO_ALLOWED_PROTOCOL_DIRS = root;
  process.env.PROSPERO_ALLOWED_OUTPUT_DIRS = root;
  process.env.PROSPERO_ARTIFACT_KEY = ["test", "only", "local", "artifact", "key"].join("-");
  try {
    protectLocalArtifact(input, output);
    const preview = prepareProtectedArtifactRead(output);
    assert.equal(preview.plaintext_returned, false);
    assert.throws(() => readProtectedLocalArtifact(output, "0".repeat(64)));
    const result = readProtectedLocalArtifact(output, preview.confirmation_hash);
    assert.equal(result.content, secretText);
  } finally {
    if (oldProtocol === undefined) delete process.env.PROSPERO_ALLOWED_PROTOCOL_DIRS; else process.env.PROSPERO_ALLOWED_PROTOCOL_DIRS = oldProtocol;
    if (oldOutput === undefined) delete process.env.PROSPERO_ALLOWED_OUTPUT_DIRS; else process.env.PROSPERO_ALLOWED_OUTPUT_DIRS = oldOutput;
    if (oldKey === undefined) delete process.env.PROSPERO_ARTIFACT_KEY; else process.env.PROSPERO_ARTIFACT_KEY = oldKey;
    rmSync(root, { recursive: true, force: true });
  }
});
