import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { REGISTRATION_CATALOG } from "../src/registration-catalog.js";
import { extractProtocolCandidates, type LoadedProtocol } from "../src/protocol.js";

test("blank protocol template contains every registration field heading exactly once", () => {
  const template = readFileSync(path.resolve("templates/PROSPERO_PROTOCOL_TEMPLATE.md"), "utf8");
  const headings = template.split(/\r?\n/)
    .map((line) => line.match(/^## ([^#].+)$/)?.[1]?.trim())
    .filter((value): value is string => Boolean(value));
  assert.equal(headings.length, 39);
  assert.deepEqual(headings, REGISTRATION_CATALOG.map((field) => field.title));
});

test("writing guide documents all stable field keys", () => {
  const guide = readFileSync(path.resolve("docs/PROSPERO_PROTOCOL_WRITING_GUIDE.md"), "utf8");
  for (const field of REGISTRATION_CATALOG) {
    assert.match(guide, new RegExp(escapeRegExp(field.title), "i"), `missing guide entry for ${field.title}`);
  }
});

test("filled template content maps back to its stable registration key", () => {
  const blank = readFileSync(path.resolve("templates/PROSPERO_PROTOCOL_TEMPLATE.md"), "utf8");
  const text = blank.replace(
    /## Population\r?\n\r?\n/,
    "## Population\n\nIncluded: Adult women at risk of breast cancer.\nExcluded: Women with an established diagnosis.\n\n",
  );
  const protocol: LoadedProtocol = {
    source: "text",
    path: null,
    format: "markdown",
    text,
    characters: text.length,
    warnings: [],
  };
  const candidates = extractProtocolCandidates(protocol);
  assert.match(candidates.population ?? "", /Adult women at risk/);
  assert.doesNotMatch(candidates.population ?? "", /## Intervention/);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
