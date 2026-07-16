#!/usr/bin/env node
import "dotenv/config";

import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";

import {
  loadProsperoSessionState,
  resolveBrowserPath,
  resolveProsperoSessionStatePath,
  resolveProsperoUserDataDir,
} from "./prospero-browser.js";
import { ProsperoClient } from "./prospero-client.js";
import { resolveConfig } from "./config.js";
import { openProsperoLoginBrowser, startProsperoRegistration } from "./prospero-page.js";

const checkOnly = process.argv.includes("--check-only");

async function main() {
  print("PROSPERO MCP first-time setup");
  print("This setup never asks for or prints your PROSPERO password.");

  assertNodeVersion();
  const browserPath = await resolveBrowserPath();
  print(`✓ Node.js ${process.versions.node}`);
  print(`✓ Browser found: ${browserPath}`);

  let session = loadProsperoSessionState();
  if (!session && checkOnly) {
    throw new Error("No saved login session. Run npm run setup:prospero.");
  }

  if (!session) {
    const prompt = createInterface({ input, output });
    try {
      await prompt.question(
        "\nPress Enter to open the dedicated PROSPERO login browser. Log in there; do not enter credentials in this terminal. ",
      );
    } finally {
      prompt.close();
    }
    await openProsperoLoginBrowser();
    session = loadProsperoSessionState();
    if (!session) throw new Error("Login was not captured. Run setup again and complete PROSPERO login.");
  }

  validateStoredSession(session.user, session.token);
  print(`✓ Login session captured locally: ${resolveProsperoSessionStatePath()}`);

  const client = new ProsperoClient(resolveConfig());
  const search = await client.search({ query: "breast cancer", page: 1, page_size: 1 });
  if (search.total_hits < 1) throw new Error("PROSPERO public search returned no results.");
  print(`✓ Public search works (${search.total_hits} matching records in the smoke test)`);

  const protectedPage = await startProsperoRegistration();
  if (protectedPage.login_required) {
    throw new Error("The saved session was rejected by PROSPERO. Run npm run login:prospero again.");
  }
  print("✓ Protected PROSPERO page is accessible");

  const configPath = writeMcpConfigExample();
  print(`✓ MCP configuration example written to: ${configPath}`);
  print("\nSetup complete. Copy the generated MCP entry into your MCP client, restart it, then call prospero_health.");
}

function assertNodeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isFinite(major) || major < 20) {
    throw new Error(`Node.js 20 or newer is required; found ${process.versions.node}.`);
  }
}

function validateStoredSession(userRaw: string, token: string) {
  if (token.length < 20) throw new Error("The saved PROSPERO session token is invalid.");
  try {
    const user = JSON.parse(userRaw) as Record<string, unknown>;
    if (typeof user.useruuid !== "string" || user.useruuid.length === 0) {
      throw new Error("missing user identity");
    }
  } catch {
    throw new Error("The saved PROSPERO user session is invalid. Run npm run login:prospero again.");
  }
}

function writeMcpConfigExample(): string {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const installedServerPath = path.join(moduleDirectory, "server.js");
  const sourceCheckoutServerPath = path.resolve(process.cwd(), "dist", "server.js");
  const serverPath = existsSync(installedServerPath) ? installedServerPath : sourceCheckoutServerPath;
  if (!existsSync(serverPath)) {
    throw new Error("dist/server.js is missing. Run npm run build, then run setup again.");
  }

  const generatedPath = path.resolve(process.cwd(), ".prospero-mcp.generated.json");
  const config = {
    mcpServers: {
      prospero: {
        command: process.execPath,
        args: [serverPath],
        env: {
          PROSPERO_USER_DATA_DIR: resolveProsperoUserDataDir(),
        },
      },
    },
  };
  writeFileSync(generatedPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return generatedPath;
}

function print(message: string) {
  process.stdout.write(`${message}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\nSetup failed: ${message}\n`);
  process.exit(1);
});
