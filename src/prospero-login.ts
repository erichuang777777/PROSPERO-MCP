#!/usr/bin/env node
import "dotenv/config";

import { openProsperoLoginBrowser } from "./prospero-page.js";

async function main() {
  process.stdout.write(
    [
      "[prospero-mcp] launching PROSPERO login browser",
      `[prospero-mcp] profile dir: ${process.env.PROSPERO_USER_DATA_DIR ?? ".prospero-profile"}`,
      "[prospero-mcp] log in; the browser closes automatically after the session is captured",
    ].join("\n") + "\n",
  );

  await openProsperoLoginBrowser();
  process.stdout.write("[prospero-mcp] login session captured in the profile dir\n");
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`[prospero-mcp] login bootstrap failed: ${message}\n`);
  process.exit(1);
});
