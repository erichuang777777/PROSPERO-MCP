import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { analyzeRegistrationFields } from "../src/registration-assistant.js";
import type { LoadedProtocol } from "../src/protocol.js";
import { compareRegistrationVersions, copyConfirmedQueueField, prepareClipboardQueue, renderRegistrationPreview, validateAdvancedConsistency, validateSearchStrategy } from "../src/safe-automation.js";

test("advanced validators flag method conflicts and unsafe search syntax", () => {
  const consistency = validateAdvancedConsistency({ objectives: "comparative effectiveness versus placebo", comparators: "This review has no comparator", synthesis_strategy: "random-effects meta-analysis", main_outcomes: "Mortality" });
  assert.equal(consistency.some((item) => item.code === "COMPARATOR_CONFLICT"), true);
  assert.equal(consistency.some((item) => item.code === "META_EFFECT_MEASURE_MISSING"), true);
  const search = validateSearchStrategy("(breast cancer AND prediction NOT screening", { condition: ["breast cancer"] }, "PubMed");
  assert.equal(search.some((item) => item.code === "UNBALANCED_PARENTHESES"), true);
  assert.equal(search.some((item) => item.code === "NOT_REQUIRES_REVIEW"), true);
});

test("version diff flags changes to review methods", () => {
  const diff = compareRegistrationVersions({ population: "Adults" }, { population: "Children" });
  assert.equal(diff.potential_major_revision, true);
  assert.equal(diff.changes[0]?.key, "population");
});

test("preview escapes content and clipboard queue excludes declarations", async () => {
  const text = "# Review title\nSafe <script>alert(1)</script> title";
  const protocol: LoadedProtocol = { source: "text", path: null, format: "markdown", text, characters: text.length, warnings: [] };
  const manifest = analyzeRegistrationFields(protocol, { review_title: "Safe <script>alert(1)</script> title" }, { review_title: "Safe <script>alert(1)</script> title", funding: "None" }, ["review_title", "funding"]);
  const html = renderRegistrationPreview(manifest);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
  const directory = mkdtempSync(path.join(os.tmpdir(), "prospero-clipboard-"));
  const old = process.env.PROSPERO_CLIPBOARD_DIR;
  const oldEnabled = process.env.PROSPERO_ENABLE_CLIPBOARD;
  process.env.PROSPERO_CLIPBOARD_DIR = directory;
  process.env.PROSPERO_ENABLE_CLIPBOARD = "false";
  try {
    const queue = prepareClipboardQueue(manifest);
    const saved = JSON.parse(readFileSync(queue.path, "utf8")) as { items: Array<{ key: string }> };
    assert.deepEqual(saved.items.map((item) => item.key), ["review_title"]);
    await assert.rejects(copyConfirmedQueueField(queue.queue_id, "review_title", queue.queue_id), /Clipboard assistance is disabled/);
  } finally {
    if (old === undefined) delete process.env.PROSPERO_CLIPBOARD_DIR; else process.env.PROSPERO_CLIPBOARD_DIR = old;
    if (oldEnabled === undefined) delete process.env.PROSPERO_ENABLE_CLIPBOARD; else process.env.PROSPERO_ENABLE_CLIPBOARD = oldEnabled;
    rmSync(directory, { recursive: true, force: true });
  }
});
