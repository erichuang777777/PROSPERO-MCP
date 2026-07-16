import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { ProsperoError } from "./errors.js";
import { findCatalogField } from "./registration-catalog.js";
import { REGISTRATION_CONSTRAINTS_BY_KEY } from "./registration-snapshot.js";
import type { ProsperoDraft, ProsperoRegistrationSchema } from "./types.js";
import { atomicWriteFileSync } from "./atomic-file.js";

export interface RegistrationPatchChange {
  key: string;
  title: string;
  route: string;
  current_value: string;
  new_value: string;
  changed: boolean;
  provenance: string;
  confidence: "low" | "medium" | "high";
}

export interface RegistrationPatch {
  version: 1;
  mode: "save_for_later_only";
  draft: Pick<ProsperoDraft, "record_id" | "record_version_id" | "title" | "last_edited_at">;
  created_at: string;
  changes: RegistrationPatchChange[];
  confirmation_hash: string;
}

export function createRegistrationPatch(
  draft: ProsperoDraft,
  schema: ProsperoRegistrationSchema,
  proposedAnswers: Record<string, string>,
  provenance: Record<string, string> = {},
  confidence: Record<string, "low" | "medium" | "high"> = {},
): RegistrationPatch {
  const liveFields = new Map(schema.sections.flatMap((section) => section.fields).map((field) => [field.title.toLowerCase(), field]));
  const changes: RegistrationPatchChange[] = [];
  for (const [key, newValueRaw] of Object.entries(proposedAnswers)) {
    const catalog = findCatalogField(key);
    if (!catalog) {
      throw new ProsperoError({
        code: "UNSUPPORTED_FIELD",
        message: `Unknown registration field key: ${key}.`,
        retryable: false,
        action: "Use a key from the 39-field registration catalog.",
      });
    }
    const live = liveFields.get(catalog.title.toLowerCase());
    if (!live?.detail_captured || !live.route) {
      throw new ProsperoError({
        code: "SITE_SCHEMA_CHANGED",
        message: `Live field details were not captured for ${catalog.title}.`,
        retryable: true,
        action: "Capture the selected fields with prospero_get_registration_schema and retry.",
      });
    }
    const currentValue = readCurrentControlValue(live.controls);
    const newValue = newValueRaw.trim();
    changes.push({
      key: catalog.key,
      title: catalog.title,
      route: live.route,
      current_value: currentValue,
      new_value: newValue,
      changed: normalizeComparison(currentValue) !== normalizeComparison(newValue),
      provenance: provenance[key] ?? "user-provided",
      confidence: confidence[key] ?? "medium",
    });
  }

  const base = {
    version: 1 as const,
    mode: "save_for_later_only" as const,
    draft: {
      record_id: draft.record_id,
      record_version_id: draft.record_version_id,
      title: draft.title,
      last_edited_at: draft.last_edited_at,
    },
    created_at: new Date().toISOString(),
    changes,
  };
  return { ...base, confirmation_hash: hashPatch(base) };
}

export function verifyRegistrationPatch(patch: RegistrationPatch, suppliedHash: string): void {
  const { confirmation_hash: _ignored, ...base } = patch;
  const expected = hashPatch(base);
  if (patch.confirmation_hash !== expected || suppliedHash !== expected) {
    throw new ProsperoError({
      code: "WRITE_CONFIRMATION_REQUIRED",
      message: "The registration patch confirmation hash is missing or does not match.",
      retryable: false,
      action: "Run prospero_prepare_registration_patch again and explicitly return its confirmation_hash.",
    });
  }
  for (const change of patch.changes) {
    const catalog = findCatalogField(change.key);
    const constraint = REGISTRATION_CONSTRAINTS_BY_KEY.get(change.key);
    if (!catalog || !constraint || change.title !== catalog.title || change.route !== constraint.route) {
      throw new ProsperoError({
        code: "UNSUPPORTED_FIELD",
        message: `Patch field ${change.key} does not match the tested registration route allowlist.`,
        retryable: false,
        action: "Prepare a new patch with the current supported field catalog.",
      });
    }
  }
}

export function storePreparedPatchReceipt(patch: RegistrationPatch): string {
  const directory = resolvePatchDirectory();
  mkdirSync(directory, { recursive: true });
  const receiptPath = path.join(directory, `${patch.confirmation_hash}.json`);
  const receipt = {
    version: 1,
    confirmation_hash: patch.confirmation_hash,
    record_id: patch.draft.record_id,
    record_version_id: patch.draft.record_version_id,
    fields: patch.changes.map((change) => change.key),
    created_at: patch.created_at,
    consumed_at: null,
  };
  atomicWriteFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return receiptPath;
}

export function assertPreparedPatchReceipt(patch: RegistrationPatch): void {
  const receiptPath = path.join(resolvePatchDirectory(), `${patch.confirmation_hash}.json`);
  if (!existsSync(receiptPath)) {
    throw new ProsperoError({
      code: "WRITE_CONFIRMATION_REQUIRED",
      message: "No local receipt exists for this dry-run patch.",
      retryable: false,
      action: "Run prospero_prepare_registration_patch on this machine before applying it.",
    });
  }
  try {
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as Record<string, unknown>;
    if (receipt.confirmation_hash !== patch.confirmation_hash || receipt.record_version_id !== patch.draft.record_version_id || receipt.consumed_at) {
      throw new Error("receipt mismatch or already consumed");
    }
  } catch (error) {
    throw new ProsperoError({
      code: "WRITE_CONFIRMATION_REQUIRED",
      message: "The local dry-run receipt is invalid or already consumed.",
      retryable: false,
      action: "Prepare and review a new patch before applying it.",
    }, { cause: error });
  }
}

export function consumePreparedPatchReceipt(patch: RegistrationPatch): void {
  const receiptPath = path.join(resolvePatchDirectory(), `${patch.confirmation_hash}.json`);
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as Record<string, unknown>;
  receipt.consumed_at = new Date().toISOString();
  atomicWriteFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

export function assertWritesEnabled(): void {
  if (process.env.PROSPERO_ENABLE_WRITES !== "true") {
    throw new ProsperoError({
      code: "WRITE_DISABLED",
      message: "PROSPERO write assistance is disabled.",
      retryable: false,
      action: "Set PROSPERO_ENABLE_WRITES=true only after reviewing the safety model and dry-run patch.",
    });
  }
}

function readCurrentControlValue(controls: ProsperoRegistrationSchema["sections"][number]["fields"][number]["controls"]): string {
  const selected = controls.filter((control) => control.checked === true).map((control) => control.label || control.value);
  if (selected.length) return selected.join("; ");
  const values = controls.map((control) => control.value.trim()).filter(Boolean);
  return values.join("\n");
}

function normalizeComparison(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function hashPatch(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function resolvePatchDirectory(): string {
  return path.resolve(process.env.PROSPERO_PATCH_DIR ?? ".prospero-patches");
}
