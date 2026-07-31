// Runs on `npm install` (local + git-hosted installs) so a one-command install such as
// `npm install -g github:erichuang777777/PROSPERO-MCP` produces a working dist/.
// It skips gracefully when the TypeScript toolchain is absent (e.g. production-only installs
// of an already-built tarball), so it can never break an otherwise valid install.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function hasTypeScript() {
  try {
    require.resolve("typescript");
    return true;
  } catch {
    return false;
  }
}

const alreadyBuilt = existsSync(new URL("../dist/server.js", import.meta.url));

// `npm pack`/`npm publish` run prepack (which produces the declaration/map-free release build)
// BEFORE prepare. Skipping when dist/ already exists preserves that release build instead of
// clobbering it with the debug build, while git/source installs (no dist/) still build here.
if (alreadyBuilt) {
  process.exit(0);
}

if (!hasTypeScript()) {
  console.warn("[prospero-mcp] Skipping build: TypeScript is not installed and no prebuilt dist/ was found.");
  process.exit(0);
}

const result = spawnSync("npm", ["run", "build"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 0);
