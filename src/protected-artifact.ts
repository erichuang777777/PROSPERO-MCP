import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { ProsperoError } from "./errors.js";
import { assertAllowedOutputPath, assertAllowedProtocolPath } from "./safety-policy.js";
import { atomicWriteFileSync } from "./atomic-file.js";

interface ProtectedArtifactEnvelope {
  version: 1;
  protection: "windows-dpapi" | "aes-256-gcm";
  payload: string;
  iv?: string;
  salt?: string;
  tag?: string;
}

export function protectLocalArtifact(inputPath: string, outputPath: string): { output_path: string; protection: ProtectedArtifactEnvelope["protection"] } {
  const safeInput = assertAllowedProtocolPath(inputPath);
  const safeOutput = assertAllowedOutputPath(outputPath);
  const plaintext = readFileSync(safeInput);
  const envelope = process.platform === "win32" ? protectDpapi(plaintext) : protectAes(plaintext);
  atomicWriteFileSync(safeOutput, `${JSON.stringify(envelope, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return { output_path: safeOutput, protection: envelope.protection };
}

export function prepareProtectedArtifactRead(inputPath: string): { confirmation_hash: string; protection: string; bytes: number; plaintext_returned: false } {
  const safeInput = assertAllowedProtocolPath(inputPath);
  const raw = readFileSync(safeInput);
  const envelope = JSON.parse(raw.toString("utf8")) as ProtectedArtifactEnvelope;
  if (envelope.version !== 1) throw invalidArtifact();
  return { confirmation_hash: createHash("sha256").update(raw).digest("hex"), protection: envelope.protection, bytes: raw.length, plaintext_returned: false };
}

export function readProtectedLocalArtifact(inputPath: string, confirmationHash: string): { content: string; protection: string } {
  const safeInput = assertAllowedProtocolPath(inputPath);
  const raw = readFileSync(safeInput);
  const expected = createHash("sha256").update(raw).digest("hex");
  if (!confirmationHash || confirmationHash !== expected) throw new ProsperoError({ code: "WRITE_CONFIRMATION_REQUIRED", message: "Protected artifact plaintext release requires the exact confirmation hash.", retryable: false, action: "Call the read tool without a hash, review the metadata, then return confirmation_hash exactly." });
  const envelope = JSON.parse(raw.toString("utf8")) as ProtectedArtifactEnvelope;
  if (envelope.version !== 1) throw invalidArtifact();
  const plaintext = envelope.protection === "windows-dpapi" ? unprotectDpapi(envelope) : unprotectAes(envelope);
  return { content: plaintext.toString("utf8"), protection: envelope.protection };
}

function protectDpapi(plaintext: Buffer): ProtectedArtifactEnvelope {
  return { version: 1, protection: "windows-dpapi", payload: runDpapi("protect", plaintext.toString("base64")) };
}
function unprotectDpapi(envelope: ProtectedArtifactEnvelope): Buffer {
  return Buffer.from(runDpapi("unprotect", envelope.payload), "base64");
}
function runDpapi(operation: "protect" | "unprotect", input: string): string {
  const script = operation === "protect"
    ? "Add-Type -AssemblyName System.Security;$v=[Console]::In.ReadToEnd();$b=[Convert]::FromBase64String($v);$o=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($o))"
    : "Add-Type -AssemblyName System.Security;$v=[Console]::In.ReadToEnd();$b=[Convert]::FromBase64String($v);$o=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($o))";
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { input, encoding: "utf8", windowsHide: true });
  if (result.status !== 0 || !result.stdout.trim()) throw new ProsperoError({ code: "CONFIG_ERROR", message: "Windows DPAPI artifact protection failed.", retryable: false, action: "Verify PowerShell and the current Windows user profile." });
  return result.stdout.trim();
}
function protectAes(plaintext: Buffer): ProtectedArtifactEnvelope {
  const secret = requireArtifactKey(); const salt = randomBytes(16); const iv = randomBytes(12); const key = scryptSync(secret, salt, 32); const cipher = createCipheriv("aes-256-gcm", key, iv); const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { version: 1, protection: "aes-256-gcm", payload: encrypted.toString("base64"), iv: iv.toString("base64"), salt: salt.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}
function unprotectAes(envelope: ProtectedArtifactEnvelope): Buffer {
  if (!envelope.iv || !envelope.salt || !envelope.tag) throw invalidArtifact();
  const key = scryptSync(requireArtifactKey(), Buffer.from(envelope.salt, "base64"), 32); const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64")); decipher.setAuthTag(Buffer.from(envelope.tag, "base64")); return Buffer.concat([decipher.update(Buffer.from(envelope.payload, "base64")), decipher.final()]);
}
function requireArtifactKey(): string {
  const value = process.env.PROSPERO_ARTIFACT_KEY;
  if (!value || value.length < 16) throw new ProsperoError({ code: "CONFIG_ERROR", message: "PROSPERO_ARTIFACT_KEY must contain at least 16 characters on non-Windows systems.", retryable: false, action: "Set a strong local key outside Git." });
  return value;
}
function invalidArtifact(): ProsperoError { return new ProsperoError({ code: "VALIDATION_ERROR", message: "Protected artifact envelope is invalid.", retryable: false, action: "Use an artifact created by this MCP under the same user/key." }); }
