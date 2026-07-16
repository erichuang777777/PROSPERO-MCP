import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("CLI emits structured health and usage errors", () => {
  const env = { ...process.env, PROSPERO_NETWORK_MODE: "offline" };
  const health = spawnSync(process.execPath, [path.resolve("dist/cli.js"), "health"], { encoding: "utf8", env });
  assert.equal(health.status, 0);
  assert.equal(JSON.parse(health.stdout).ok, true);
  const invalid = spawnSync(process.execPath, [path.resolve("dist/cli.js"), "unknown"], { encoding: "utf8", env });
  assert.equal(invalid.status, 2);
  assert.equal(JSON.parse(invalid.stderr).error.code, "CLI_USAGE");
});

test("CLI copies the blank template only to an allowlisted output", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "prospero-cli-"));
  const output = path.join(root, "protocol.md");
  try {
    const result = spawnSync(process.execPath, [path.resolve("dist/cli.js"), "template", "--output", output], { encoding: "utf8", env: { ...process.env, PROSPERO_ALLOWED_OUTPUT_DIRS: root } });
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(output, "utf8"), /# Systematic Review Protocol/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("skill installer targets CODEX_HOME without overwriting by default", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "prospero-skill-"));
  try {
    const first = spawnSync(process.execPath, [path.resolve("dist/install-skill.js")], { encoding: "utf8", env: { ...process.env, CODEX_HOME: root } });
    assert.equal(first.status, 0, first.stderr);
    assert.match(readFileSync(path.join(root, "skills", "prospero-research", "SKILL.md"), "utf8"), /name: prospero-research/);
    const second = spawnSync(process.execPath, [path.resolve("dist/install-skill.js")], { encoding: "utf8", env: { ...process.env, CODEX_HOME: root } });
    assert.equal(second.status, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
