import assert from "node:assert/strict";
import test from "node:test";

import { analyzeRegistrationFields, buildMissingInformationInterview } from "../src/registration-assistant.js";
import type { LoadedProtocol } from "../src/protocol.js";

const text = "# Review title\nBreast cancer prediction tests: a systematic review\n# Review objectives\nTo evaluate prediction tests for women at risk of breast cancer.";
const protocol: LoadedProtocol = { source: "text", path: null, format: "markdown", text, characters: text.length, warnings: [] };

test("registration analysis separates extracted, missing and human-confirmed fields", () => {
  const extracted = { review_title: "Breast cancer prediction tests: a systematic review", objectives: "To evaluate prediction tests for women at risk of breast cancer." };
  const manifest = analyzeRegistrationFields(protocol, extracted, { ...extracted, funding: "No external funding" }, ["review_title"]);
  assert.equal(manifest.fields.find((field) => field.key === "review_title")?.state, "confirmed");
  assert.equal(manifest.fields.find((field) => field.key === "objectives")?.state, "extracted");
  assert.equal(manifest.fields.find((field) => field.key === "population")?.state, "missing");
  assert.equal(manifest.fields.find((field) => field.key === "funding")?.state, "needs_confirmation");
  assert.equal(buildMissingInformationInterview(manifest).some((item) => item.key === "funding" && item.requires_human_declaration), true);
});

test("confirmed source becomes stale when protocol evidence changes", () => {
  const first = analyzeRegistrationFields(protocol, { objectives: "Old objective" }, { objectives: "Old objective" }, ["objectives"]);
  const second = analyzeRegistrationFields(protocol, { objectives: "New objective" }, { objectives: "New objective" }, [], first);
  assert.equal(second.fields.find((field) => field.key === "objectives")?.state, "stale");
});
