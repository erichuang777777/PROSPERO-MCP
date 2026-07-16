#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const force = process.argv.includes("--force");
const codexHome = path.resolve(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"));
const skillsRoot = path.join(codexHome, "skills");
const target = path.join(skillsRoot, "prospero-research");
const source = fileURLToPath(new URL("../skills/prospero-research", import.meta.url));

if (existsSync(target) && !force) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: { code: "SKILL_EXISTS", message: `Skill already exists at ${target}.`, retryable: false, action: "Review the existing skill, then rerun with --force only if replacement is intended." } }, null, 2)}\n`);
  process.exitCode = 2;
} else {
  mkdirSync(skillsRoot, { recursive: true });
  cpSync(source, target, { recursive: true, force });
  process.stdout.write(`${JSON.stringify({ ok: true, data: { skill: "prospero-research", installed_path: target, restart_required: true } }, null, 2)}\n`);
}
