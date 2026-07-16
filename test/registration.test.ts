import assert from "node:assert/strict";
import test from "node:test";

import { loadProtocol, extractProtocolCandidates, renderRegistrationWorkbook } from "../src/protocol.js";
import { REGISTRATION_CATALOG } from "../src/registration-catalog.js";
import { validateRegistration } from "../src/registration-validator.js";
import { REGISTRATION_CONSTRAINTS } from "../src/registration-snapshot.js";

test("registration catalog contains the expected 12 sections and 39 fields", () => {
  assert.equal(REGISTRATION_CATALOG.length, 39);
  assert.equal(new Set(REGISTRATION_CATALOG.map((field) => field.section)).size, 12);
  assert.equal(new Set(REGISTRATION_CATALOG.map((field) => field.key)).size, 39);
  assert.equal(REGISTRATION_CONSTRAINTS.length, 39);
  assert.deepEqual(REGISTRATION_CONSTRAINTS.map((item) => item.key), REGISTRATION_CATALOG.map((item) => item.key));
});

test("protocol headings produce workbook candidates", async () => {
  const protocol = await loadProtocol({
    protocol_text: `# Review title\nEffects of nurse-led supportive care for preterm infants in neonatal intensive care\n\n# Population\nPreterm infants admitted to a neonatal intensive care unit.\n\n# Primary outcomes\nPain score and sleep behaviour.`,
  });
  const candidates = extractProtocolCandidates(protocol);
  assert.match(candidates.review_title ?? "", /nurse-led supportive care/i);
  assert.match(candidates.population ?? "", /preterm infants/i);
  assert.match(candidates.main_outcomes ?? "", /pain score/i);
  const workbook = renderRegistrationWorkbook(protocol, candidates);
  assert.match(workbook, /# ELIGIBILITY CRITERIA/);
  assert.match(workbook, /Preterm infants admitted/);
});

test("registration validator enforces confirmed title limits and consistency", () => {
  const result = validateRegistration({
    review_title: "Too short",
    review_type: "Intervention review",
    interventions_exposures: "Supportive care",
    language_restrictions: "English only",
    context: "No language restriction will be used",
  });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "TITLE_WORD_LIMIT"));
  assert.ok(result.issues.some((issue) => issue.code === "LANGUAGE_CONTRADICTION"));
  assert.ok(result.issues.some((issue) => issue.code === "COMPARATOR_UNCLEAR"));
});
