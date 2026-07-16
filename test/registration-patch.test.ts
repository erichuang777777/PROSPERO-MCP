import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ProsperoError } from "../src/errors.js";
import {
  assertPreparedPatchReceipt,
  assertWritesEnabled,
  consumePreparedPatchReceipt,
  createRegistrationPatch,
  storePreparedPatchReceipt,
  verifyRegistrationPatch,
} from "../src/registration-patch.js";
import type { ProsperoDraft, ProsperoRegistrationSchema } from "../src/types.js";

test("registration patch is deterministic and verifies its confirmation hash", () => {
  const patch = createRegistrationPatch(draft(), schema(), {
    review_title: "A systematic review of nursing support for preterm infant pain",
  }, { review_title: "protocol.md#title" }, { review_title: "high" });
  assert.equal(patch.changes[0]?.current_value, "Old review title text");
  assert.equal(patch.changes[0]?.changed, true);
  verifyRegistrationPatch(patch, patch.confirmation_hash);
  assert.throws(
    () => verifyRegistrationPatch(patch, "0".repeat(64)),
    (error: unknown) => error instanceof ProsperoError && error.code === "WRITE_CONFIRMATION_REQUIRED",
  );
});

test("writes are disabled by default", () => {
  const previous = process.env.PROSPERO_ENABLE_WRITES;
  delete process.env.PROSPERO_ENABLE_WRITES;
  try {
    assert.throws(
      () => assertWritesEnabled(),
      (error: unknown) => error instanceof ProsperoError && error.code === "WRITE_DISABLED",
    );
  } finally {
    if (previous !== undefined) process.env.PROSPERO_ENABLE_WRITES = previous;
  }
});

test("prepared patch receipts are local and single use", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "prospero-patch-"));
  const previous = process.env.PROSPERO_PATCH_DIR;
  process.env.PROSPERO_PATCH_DIR = directory;
  try {
    const patch = createRegistrationPatch(draft(), schema(), {
      review_title: "A systematic review of nursing support for preterm infant pain",
    });
    const receiptPath = storePreparedPatchReceipt(patch);
    assert.equal(path.dirname(receiptPath), directory);
    assert.doesNotThrow(() => assertPreparedPatchReceipt(patch));
    consumePreparedPatchReceipt(patch);
    assert.throws(
      () => assertPreparedPatchReceipt(patch),
      (error: unknown) => error instanceof ProsperoError && error.code === "WRITE_CONFIRMATION_REQUIRED",
    );
  } finally {
    if (previous === undefined) delete process.env.PROSPERO_PATCH_DIR;
    else process.env.PROSPERO_PATCH_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

function draft(): ProsperoDraft {
  return {
    record_id: 1,
    accession_number: "1",
    record_version_id: "2C547325-4893-4938-9810-CD7594720367",
    template_id: "1",
    template_variant: "Intervention",
    purpose: "live",
    publication_status: "Not yet registered",
    editing_status: "In process",
    title: "Untitled",
    created_at: "2026-01-01T00:00:00Z",
    last_edited_at: "2026-01-01T00:00:00Z",
    editable: true,
  };
}

function schema(): ProsperoRegistrationSchema {
  return {
    captured_at: "2026-01-01T00:00:00Z",
    source: "live",
    draft: draft(),
    total_fields: 1,
    detailed_fields: 1,
    sections: [{
      title: "REVIEW TITLE AND BASIC DETAILS",
      intro_text: "",
      fields: [{
        section: "REVIEW TITLE AND BASIC DETAILS",
        title: "Review title",
        status: "Not started",
        route: "/PROSPERO/register/TemplateTitle",
        instructions: "",
        required: true,
        minimum_words: 5,
        maximum_words: 30,
        detail_captured: true,
        controls: [{
          tag: "div",
          type: "",
          name: "",
          id: "",
          label: "",
          required: false,
          placeholder: "",
          options: [],
          context: "",
          value: "Old review title text",
          checked: null,
        }],
      }],
    }],
  };
}
