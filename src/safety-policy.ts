import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

import { ProsperoError } from "./errors.js";

export type NetworkMode = "online" | "offline";

export interface PrivacyFinding {
  type: "email" | "phone" | "token" | "clinical_identifier";
  preview: string;
}

export function networkMode(): NetworkMode {
  return process.env.PROSPERO_NETWORK_MODE?.toLowerCase() === "offline" ? "offline" : "online";
}

export function assertExternalNetworkAllowed(source: "prospero" | "pubmed"): void {
  if (networkMode() === "offline") {
    throw new ProsperoError({
      code: "WRITE_DISABLED",
      message: `External ${source} access is disabled by PROSPERO_NETWORK_MODE=offline.`,
      retryable: false,
      action: "Use local drafting tools or explicitly enable online mode after reviewing outbound queries.",
      details: { source, network_mode: "offline" },
    });
  }
}

export function scanOutboundText(value: string): PrivacyFinding[] {
  const findings: PrivacyFinding[] = [];
  collect(findings, value, "email", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi);
  collect(findings, value, "token", /\b(?:eyJ[A-Za-z0-9_-]{20,}|[A-Fa-f0-9]{32,})\b/g);
  collect(findings, value, "clinical_identifier", /\b(?:MRN|medical record|patient id|subject id)\s*[:#-]?\s*[A-Z0-9-]{4,}\b/gi);
  // Require an international +prefix or the classic 3-3-4 grouping so accession numbers,
  // ISO dates and other registry identifiers are not flagged as phone numbers.
  collect(findings, value, "phone", /(?:\+\d[\d ()-]{8,}\d|(?<!\w)\(?\d{3}\)?[ -]\d{3}[ -]\d{4}(?!\w))/g);
  return findings;
}

export function assertSafeOutboundText(value: string, source: "prospero" | "pubmed"): void {
  const findings = scanOutboundText(value);
  if (findings.length) {
    throw new ProsperoError({
      code: "VALIDATION_ERROR",
      message: `Outbound ${source} query may contain personal, clinical or secret data.`,
      retryable: false,
      action: "Replace identifiers with non-identifying PICO search terms and retry.",
      details: { source, findings },
    });
  }
}

export function assertAllowedProtocolPath(filePath: string): string {
  return assertAllowedPath(filePath, allowedRoots("PROSPERO_ALLOWED_PROTOCOL_DIRS"), "protocol", true);
}

export function assertAllowedOutputPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  const parent = path.dirname(resolved);
  if (!existsSync(parent)) {
    throw new ProsperoError({
      code: "VALIDATION_ERROR",
      message: "The output parent directory does not exist.",
      retryable: false,
      action: "Create and explicitly allow the output directory before writing.",
      details: { parent },
    });
  }
  const allowed = allowedRoots("PROSPERO_ALLOWED_OUTPUT_DIRS");
  const realParent = realpathSync(parent);
  assertWithinRoots(realParent, allowed, "output");
  return path.join(realParent, path.basename(resolved));
}

export function describeSafetyPolicy() {
  return {
    network_mode: networkMode(),
    allowed_protocol_dirs: allowedRoots("PROSPERO_ALLOWED_PROTOCOL_DIRS"),
    allowed_output_dirs: allowedRoots("PROSPERO_ALLOWED_OUTPUT_DIRS"),
    outbound_privacy_scan: true,
  };
}

function assertAllowedPath(filePath: string, roots: string[], kind: string, mustExist: boolean): string {
  const resolved = path.resolve(filePath);
  if (mustExist && !existsSync(resolved)) {
    throw new ProsperoError({ code: "VALIDATION_ERROR", message: `The ${kind} path does not exist.`, retryable: false, action: "Provide an existing allowed path.", details: { path: resolved } });
  }
  const real = realpathSync(resolved);
  assertWithinRoots(real, roots, kind);
  return real;
}

function assertWithinRoots(candidate: string, roots: string[], kind: string): void {
  const normalized = normalize(candidate);
  const allowed = roots.some((root) => normalized === normalize(root) || normalized.startsWith(`${normalize(root)}${path.sep}`));
  if (!allowed) {
    throw new ProsperoError({
      code: "VALIDATION_ERROR",
      message: `The ${kind} path is outside the configured allowlist.`,
      retryable: false,
      action: `Add the trusted directory to ${kind === "protocol" ? "PROSPERO_ALLOWED_PROTOCOL_DIRS" : "PROSPERO_ALLOWED_OUTPUT_DIRS"}.`,
      details: { path: candidate, allowed_roots: roots },
    });
  }
}

function allowedRoots(environmentName: string): string[] {
  const configured = process.env[environmentName]?.split(path.delimiter).map((value) => value.trim()).filter(Boolean) ?? [];
  const roots = configured.length ? configured : [process.cwd()];
  return roots.map((root) => {
    try {
      return realpathSync(path.resolve(root));
    } catch (error) {
      throw new ProsperoError({
        code: "CONFIG_ERROR",
        message: `Configured allowlist directory does not exist: ${root}`,
        retryable: false,
        action: `Remove or correct the entry in ${environmentName}.`,
        details: { environment: environmentName, root },
      }, { cause: error });
    }
  });
}

function normalize(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function collect(target: PrivacyFinding[], value: string, type: PrivacyFinding["type"], pattern: RegExp): void {
  for (const match of value.matchAll(pattern)) {
    const raw = match[0];
    target.push({ type, preview: raw.length <= 6 ? "***" : `${raw.slice(0, 2)}***${raw.slice(-2)}` });
  }
}
