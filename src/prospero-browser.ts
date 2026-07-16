import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { ProsperoError } from "./errors.js";

export interface ProsperoSessionState {
  token: string;
  user: string;
  captured_at: string;
}

interface StoredSessionEnvelope {
  version: 2;
  protection: "windows-dpapi" | "file-permissions";
  payload: string;
}

export interface ProsperoSessionStatus {
  state: "missing" | "invalid" | "expired" | "present";
  protection: "windows-dpapi" | "file-permissions" | "legacy-plaintext" | "none";
  captured_at: string | null;
  issued_at: string | null;
  expires_at: string | null;
  user_identity_present: boolean;
}

const DEFAULT_BROWSER_PATHS = [
  process.env.PROSPERO_BROWSER_PATH,
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].filter((value): value is string => typeof value === "string" && value.length > 0);

export async function resolveBrowserPath(): Promise<string> {
  for (const candidate of DEFAULT_BROWSER_PATHS) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new ProsperoError({
    code: "CONFIG_ERROR",
    message: "No Chromium/Chrome executable was found.",
    retryable: false,
    action: "Set PROSPERO_BROWSER_PATH or install Chrome/Edge.",
  });
}

export function resolveProsperoUserDataDir(): string {
  const raw = process.env.PROSPERO_USER_DATA_DIR ?? ".prospero-profile";
  const userDataDir = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
  mkdirSync(userDataDir, { recursive: true });
  return userDataDir;
}

export function loadProsperoSessionState(): ProsperoSessionState | null {
  const statePath = resolveProsperoSessionStatePath();
  if (!existsSync(statePath)) return null;

  try {
    const stored = JSON.parse(readFileSync(statePath, "utf8")) as Partial<ProsperoSessionState> | StoredSessionEnvelope;
    const parsed = isStoredEnvelope(stored)
      ? JSON.parse(unprotectPayload(stored)) as Partial<ProsperoSessionState>
      : stored;
    if (typeof parsed.token !== "string" || parsed.token.length === 0) return null;
    if (typeof parsed.user !== "string" || parsed.user.length === 0) return null;
    return {
      token: parsed.token,
      user: parsed.user,
      captured_at: typeof parsed.captured_at === "string" ? parsed.captured_at : "",
    };
  } catch {
    return null;
  }
}

export function saveProsperoSessionState(token: string, user: string): string {
  const statePath = resolveProsperoSessionStatePath();
  const state: ProsperoSessionState = {
    token,
    user,
    captured_at: new Date().toISOString(),
  };
  const envelope = protectPayload(JSON.stringify(state));
  writeFileSync(statePath, `${JSON.stringify(envelope, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return statePath;
}

export function getProsperoSessionStatus(now = new Date()): ProsperoSessionStatus {
  const statePath = resolveProsperoSessionStatePath();
  if (!existsSync(statePath)) {
    return {
      state: "missing",
      protection: "none",
      captured_at: null,
      issued_at: null,
      expires_at: null,
      user_identity_present: false,
    };
  }

  const protection = inspectStoredProtection(statePath);
  const session = loadProsperoSessionState();
  if (!session) {
    return {
      state: "invalid",
      protection,
      captured_at: null,
      issued_at: null,
      expires_at: null,
      user_identity_present: false,
    };
  }

  const claims = decodeJwtPayload(session.token);
  const issuedAt = typeof claims?.iat === "number" ? new Date(claims.iat * 1_000) : null;
  const expiresAt = typeof claims?.exp === "number" ? new Date(claims.exp * 1_000) : null;
  let userIdentityPresent = false;
  try {
    const user = JSON.parse(session.user) as Record<string, unknown>;
    userIdentityPresent = typeof user.useruuid === "string" && user.useruuid.length > 0;
  } catch {
    userIdentityPresent = false;
  }

  return {
    state: expiresAt && expiresAt.getTime() <= now.getTime() ? "expired" : "present",
    protection,
    captured_at: session.captured_at || null,
    issued_at: issuedAt?.toISOString() ?? null,
    expires_at: expiresAt?.toISOString() ?? null,
    user_identity_present: userIdentityPresent,
  };
}

export function resolveProsperoSessionStatePath(): string {
  return path.join(resolveProsperoUserDataDir(), "prospero-session.json");
}

export function getProsperoLoginUrl(): string {
  return "https://www.crd.york.ac.uk/PROSPERO/login";
}

function isStoredEnvelope(value: Partial<ProsperoSessionState> | StoredSessionEnvelope): value is StoredSessionEnvelope {
  const candidate = value as Record<string, unknown>;
  return candidate.version === 2 && typeof candidate.payload === "string" &&
    (candidate.protection === "windows-dpapi" || candidate.protection === "file-permissions");
}

function protectPayload(plaintext: string): StoredSessionEnvelope {
  if (process.platform === "win32") {
    return {
      version: 2,
      protection: "windows-dpapi",
      payload: runDpapi("protect", plaintext),
    };
  }
  return {
    version: 2,
    protection: "file-permissions",
    payload: Buffer.from(plaintext, "utf8").toString("base64"),
  };
}

function unprotectPayload(envelope: StoredSessionEnvelope): string {
  if (envelope.protection === "windows-dpapi") return runDpapi("unprotect", envelope.payload);
  return Buffer.from(envelope.payload, "base64").toString("utf8");
}

function runDpapi(operation: "protect" | "unprotect", input: string): string {
  const script = operation === "protect"
    ? `Add-Type -AssemblyName System.Security;$value=[Console]::In.ReadToEnd();$bytes=[Text.Encoding]::UTF8.GetBytes($value);$out=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($out))`
    : `Add-Type -AssemblyName System.Security;$value=[Console]::In.ReadToEnd();$bytes=[Convert]::FromBase64String($value);$out=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Text.Encoding]::UTF8.GetString($out))`;
  const encodedScript = Buffer.from(script, "utf16le").toString("base64");
  for (const executable of ["powershell.exe", "pwsh.exe"]) {
    const result = spawnSync(executable, ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodedScript], {
      input,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 5 * 1024 * 1024,
    });
    if (!result.error && result.status === 0 && result.stdout.trim().length > 0) return result.stdout.trim();
    if (result.error && "code" in result.error && result.error.code === "ENOENT") continue;
    throw new ProsperoError({
      code: "CONFIG_ERROR",
      message: `Windows DPAPI ${operation} failed.`,
      retryable: false,
      action: "Verify that Windows PowerShell and the current user profile are available.",
    }, { cause: result.error ?? new Error(result.stderr.trim()) });
  }
  throw new ProsperoError({
    code: "CONFIG_ERROR",
    message: "Windows PowerShell was not found for DPAPI session protection.",
    retryable: false,
    action: "Install or enable Windows PowerShell/pwsh and retry login capture.",
  });
}

function inspectStoredProtection(statePath: string): ProsperoSessionStatus["protection"] {
  try {
    const stored = JSON.parse(readFileSync(statePath, "utf8")) as Partial<StoredSessionEnvelope>;
    if (stored.version === 2 && stored.protection === "windows-dpapi") return "windows-dpapi";
    if (stored.version === 2 && stored.protection === "file-permissions") return "file-permissions";
    return "legacy-plaintext";
  } catch {
    return "none";
  }
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}
