import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ProsperoError } from "../src/errors.js";
import { parsePublicDocumentHtml, parseRegisterChecklistHtml } from "../src/prospero-html.js";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

test("public record fixture parses headings and content", () => {
  const result = parsePublicDocumentHtml(readFileSync(path.join(fixtures, "public-record.html"), "utf8"));
  assert.equal(result.title, "Breast Cancer Prediction Tests");
  assert.equal(result.sections.length, 2);
  assert.equal(result.sections[1]?.title, "SIMILAR REVIEWS");
  assert.match(result.sections[0]?.items[0]?.content ?? "", /Breast Cancer Prediction Tests/);
});

test("register checklist fixture parses progress and fields", () => {
  const result = parseRegisterChecklistHtml(readFileSync(path.join(fixtures, "register-checklist.html"), "utf8"));
  assert.equal(result.sections.length, 2);
  assert.equal(result.sections[0]?.title, "REVIEW TITLE AND BASIC DETAILS");
  assert.equal(result.sections[0]?.progress[0]?.value_max, 7);
  assert.equal(result.sections[1]?.items[0]?.active, true);
});

test("selector drift returns SITE_SCHEMA_CHANGED", () => {
  assert.throws(
    () => parseRegisterChecklistHtml("<html><body>Release version 9.9.9</body></html>"),
    (error: unknown) => error instanceof ProsperoError && error.code === "SITE_SCHEMA_CHANGED" && error.details?.release_version === "9.9.9",
  );
});
