import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

import type { RegistrationPatch } from "./registration-patch.js";
import { atomicWriteFileSync } from "./atomic-file.js";

export function writeRegistrationAudit(
  patch: RegistrationPatch,
  outcomes: Array<{ key: string; status: "saved" | "skipped" }>,
): string {
  const directory = path.resolve(process.env.PROSPERO_AUDIT_DIR ?? ".prospero-audit");
  mkdirSync(directory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const auditPath = path.join(directory, `${timestamp}-${patch.confirmation_hash.slice(0, 12)}.json`);
  const audit = {
    version: 1,
    operation: "save_for_later_only",
    timestamp: new Date().toISOString(),
    record_id: patch.draft.record_id,
    record_version_id: patch.draft.record_version_id,
    confirmation_hash: patch.confirmation_hash,
    changes: patch.changes.map((change) => ({
      key: change.key,
      route: change.route,
      current_value_sha256: sha256(change.current_value),
      new_value_sha256: sha256(change.new_value),
      provenance: change.provenance,
      confidence: change.confidence,
    })),
    outcomes,
  };
  atomicWriteFileSync(auditPath, `${JSON.stringify(audit, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return auditPath;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
