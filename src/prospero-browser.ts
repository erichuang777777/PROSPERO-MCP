import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface ProsperoSessionState {
  token: string;
  user: string;
  captured_at: string;
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
  throw new Error(
    "No Chromium/Chrome executable found. Set PROSPERO_BROWSER_PATH or install Chrome/Edge.",
  );
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
    const parsed = JSON.parse(readFileSync(statePath, "utf8")) as Partial<ProsperoSessionState>;
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
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return statePath;
}

export function resolveProsperoSessionStatePath(): string {
  return path.join(resolveProsperoUserDataDir(), "prospero-session.json");
}

export function getProsperoLoginUrl(): string {
  return "https://www.crd.york.ac.uk/PROSPERO/login";
}
