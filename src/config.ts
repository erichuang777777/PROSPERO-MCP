import "dotenv/config";

import type { ProsperoConfig } from "./types.js";

export function resolveConfig(): ProsperoConfig {
  const baseUrl =
    normalizeBaseUrl(
      process.env.PROSPERO_BASE_URL ??
        process.env.PROSPERO_API_BASE_URL ??
        "https://www.crd.york.ac.uk/PROSPERO/api/",
    ) ?? "https://www.crd.york.ac.uk/PROSPERO/api/";

  const timeoutMs = parseNumber(process.env.PROSPERO_TIMEOUT_MS, 10000);

  return {
    baseUrl,
    accessToken: process.env.PROSPERO_ACCESS_TOKEN ?? "",
    authToken: process.env.PROSPERO_AUTH_TOKEN,
    timeoutMs,
  };
}

function normalizeBaseUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    return url.toString();
  } catch {
    return null;
  }
}

function parseNumber(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
