#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const [format, filePath] = process.argv.slice(2);
const maximumCharacters = readLimit("PROSPERO_MAX_EXTRACTED_CHARACTERS", 2_000_000);
const maximumPages = readLimit("PROSPERO_MAX_PDF_PAGES", 1_000);

async function main() {
  if (!filePath || (format !== "pdf" && format !== "docx")) throw new Error("Invalid isolated parser arguments");
  if (format === "pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: await readFile(filePath) });
    try {
      const result = await parser.getText();
      if (result.total > maximumPages) throw new Error(`PDF exceeds ${maximumPages} page safety limit`);
      const text = enforceTextLimit(result.text);
      process.stdout.write(JSON.stringify({ text, pages: result.pages.map((page) => ({ page: page.num, text: page.text.slice(0, maximumCharacters) })), warnings: [] }));
    } finally { await parser.destroy(); }
    return;
  }
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ path: filePath });
  process.stdout.write(JSON.stringify({ text: enforceTextLimit(result.value), warnings: result.messages.map((message) => message.message) }));
}

function enforceTextLimit(value: string): string {
  if (value.length > maximumCharacters) throw new Error(`Extracted text exceeds ${maximumCharacters} character safety limit`);
  return value;
}
function readLimit(name: string, fallback: number): number { const value = Number.parseInt(process.env[name] ?? "", 10); return Number.isFinite(value) && value > 0 ? value : fallback; }
main().catch((error) => { process.stderr.write(error instanceof Error ? error.message : String(error)); process.exit(1); });
