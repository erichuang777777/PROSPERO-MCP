import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("MCP server starts and publishes the v0.2 tool surface", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve("dist/server.js")],
    cwd: process.cwd(),
    env: { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")), PROSPERO_TOOL_PROFILE: "full" },
    stderr: "pipe",
  });
  const client = new Client({ name: "prospero-mcp-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const result = await client.listTools();
    const names = new Set(result.tools.map((tool) => tool.name));
    for (const expected of [
      "prospero_health",
      "prospero_list_drafts",
      "prospero_get_registration_schema",
      "prospero_generate_workbook",
      "prospero_protocol_to_registration",
      "prospero_analyze_protocol",
      "prospero_validate_search_strategy",
      "prospero_compare_protocol_versions",
      "prospero_generate_local_preview",
      "prospero_prepare_clipboard_queue",
      "prospero_copy_confirmed_field",
      "prospero_monitor_similar_reviews",
      "prospero_protect_local_artifact",
      "prospero_read_protected_artifact",
      "prospero_validate_registration",
      "prospero_build_query",
      "prospero_bulk_export",
      "prospero_compare_similar_reviews",
      "prospero_prepare_registration_patch",
      "prospero_apply_registration_patch",
    ]) {
      assert.equal(names.has(expected), true, `missing MCP tool: ${expected}`);
    }
    const health = await client.callTool({ name: "prospero_health", arguments: {} });
    assert.equal(health.isError, undefined);
    assert.equal((health.structuredContent as { ok?: boolean }).ok, true);
  } finally {
    await client.close();
  }
});

test("core tool profile hides browser-write and clipboard tools", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve("dist/server.js")],
    cwd: process.cwd(),
    env: { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")), PROSPERO_TOOL_PROFILE: "core" },
    stderr: "pipe",
  });
  const client = new Client({ name: "prospero-mcp-core-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const names = new Set((await client.listTools()).tools.map((tool) => tool.name));
    assert.equal(names.has("prospero_search_protocols"), true);
    assert.equal(names.has("prospero_apply_registration_patch"), false);
    assert.equal(names.has("prospero_copy_confirmed_field"), false);
    assert.equal(names.size, 7);
  } finally { await client.close(); }
});
