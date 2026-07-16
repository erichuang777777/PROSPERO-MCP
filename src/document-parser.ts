import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ProsperoError } from "./errors.js";

export interface IsolatedDocumentResult { text: string; pages?: Array<{ page: number; text: string }>; warnings: string[] }

export function parseDocumentIsolated(filePath: string, format: "pdf" | "docx"): Promise<IsolatedDocumentResult> {
  const javascriptWorker = fileURLToPath(new URL("./document-parser-worker.js", import.meta.url));
  const typescriptWorker = fileURLToPath(new URL("./document-parser-worker.ts", import.meta.url));
  const production = existsSync(javascriptWorker);
  const worker = production ? javascriptWorker : typescriptWorker;
  const memoryMb = readLimit("PROSPERO_PARSER_MAX_OLD_SPACE_MB", 256);
  const argumentsList = [`--max-old-space-size=${Math.min(2_048, Math.max(64, memoryMb))}`, ...(production ? [] : ["--import", "tsx"]), worker, format, filePath];
  const timeout = readLimit("PROSPERO_PARSER_TIMEOUT_MS", 60_000);
  return new Promise((resolve, reject) => {
    execFile(process.execPath, argumentsList, { timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: process.env }, (error, stdout, stderr) => {
      if (error) {
        reject(new ProsperoError({ code: error.killed ? "NETWORK_TIMEOUT" : "VALIDATION_ERROR", message: error.killed ? "Document parser exceeded its time limit." : "The isolated document parser failed.", retryable: false, action: "Check whether the PDF/DOCX is damaged, encrypted, image-only or exceeds parser safety limits.", details: { format, stderr: stderr.slice(0, 500), timeout_ms: timeout, memory_mb: memoryMb } }, { cause: error }));
        return;
      }
      try { resolve(JSON.parse(stdout) as IsolatedDocumentResult); }
      catch (parseError) { reject(new ProsperoError({ code: "INVALID_RESPONSE", message: "The isolated parser returned invalid output.", retryable: false, action: "Retry with a supported document." }, { cause: parseError })); }
    });
  });
}
function readLimit(name: string, fallback: number): number { const value = Number.parseInt(process.env[name] ?? "", 10); return Number.isFinite(value) && value > 0 ? value : fallback; }
