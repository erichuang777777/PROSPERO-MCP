#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface SkillTarget {
  platform: "codex" | "claude";
  root: string;
}

const argv = process.argv.slice(2);
const force = argv.includes("--force");
const wantCodex = argv.includes("--codex");
const wantClaude = argv.includes("--claude");
// With no platform flag, install for every supported agent so a single command covers both.
const installCodex = wantCodex || !wantClaude;
const installClaude = wantClaude || !wantCodex;

const source = fileURLToPath(new URL("../skills/prospero-research", import.meta.url));

const targets: SkillTarget[] = [];
if (installCodex) targets.push({ platform: "codex", root: path.resolve(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex")) });
if (installClaude) targets.push({ platform: "claude", root: path.resolve(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude")) });

const installed: Array<{ platform: string; path: string }> = [];
const skipped: Array<{ platform: string; path: string; reason: string }> = [];

for (const { platform, root } of targets) {
  const destination = path.join(root, "skills", "prospero-research");
  if (existsSync(destination) && !force) {
    skipped.push({ platform, path: destination, reason: "SKILL_EXISTS" });
    continue;
  }
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true, force });
  installed.push({ platform, path: destination });
}

if (installed.length === 0) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: { code: "SKILL_EXISTS", message: "The skill already exists for every selected platform.", retryable: false, action: "Review the existing skill, then rerun with --force only if replacement is intended.", details: { skipped } } }, null, 2)}\n`);
  process.exitCode = 2;
} else {
  process.stdout.write(`${JSON.stringify({ ok: true, data: { skill: "prospero-research", installed, skipped, restart_required: true } }, null, 2)}\n`);
}
