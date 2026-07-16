import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ProsperoError } from "./errors.js";
import { parseDocumentIsolated } from "./document-parser.js";
import { REGISTRATION_CATALOG } from "./registration-catalog.js";
import { REGISTRATION_CONSTRAINTS_BY_KEY, REGISTRATION_SCHEMA_SNAPSHOT_META } from "./registration-snapshot.js";
import { assertAllowedProtocolPath } from "./safety-policy.js";

export interface ProtocolSourceInput {
  protocol_text?: string | undefined;
  protocol_path?: string | undefined;
}

export interface LoadedProtocol {
  source: "text" | "file";
  path: string | null;
  format: "text" | "markdown" | "pdf" | "docx";
  text: string;
  characters: number;
  warnings: string[];
  pages?: Array<{ page: number; text: string }> | undefined;
}

export async function loadProtocol(input: ProtocolSourceInput): Promise<LoadedProtocol> {
  const hasText = typeof input.protocol_text === "string" && input.protocol_text.trim().length > 0;
  const hasPath = typeof input.protocol_path === "string" && input.protocol_path.trim().length > 0;
  if (hasText === hasPath) {
    throw new ProsperoError({
      code: "VALIDATION_ERROR",
      message: "Provide exactly one of protocol_text or protocol_path.",
      retryable: false,
      action: "Supply protocol text directly or one supported local file path.",
    });
  }

  if (hasText) {
    const text = normalizeExtractedText(input.protocol_text!);
    return { source: "text", path: null, format: "text", text, characters: text.length, warnings: [] };
  }

  const resolved = assertAllowedProtocolPath(input.protocol_path!);
  const info = await stat(resolved).catch((error) => {
    throw new ProsperoError({
      code: "VALIDATION_ERROR",
      message: "The protocol file does not exist or cannot be read.",
      retryable: false,
      action: "Provide an accessible TXT, MD, PDF or DOCX file.",
      details: { path: resolved },
    }, { cause: error });
  });
  if (!info.isFile() || info.size > 25 * 1024 * 1024) {
    throw new ProsperoError({
      code: "VALIDATION_ERROR",
      message: "The protocol must be a file no larger than 25 MB.",
      retryable: false,
      action: "Provide a smaller TXT, MD, PDF or DOCX file.",
      details: { path: resolved, bytes: info.size },
    });
  }

  const extension = path.extname(resolved).toLowerCase();
  let text: string;
  let format: LoadedProtocol["format"];
  let pages: LoadedProtocol["pages"];
  const warnings: string[] = [];
  if (extension === ".txt" || extension === ".md" || extension === ".markdown") {
    text = await readFile(resolved, "utf8");
    format = extension === ".txt" ? "text" : "markdown";
  } else if (extension === ".pdf") {
    const result = await parseDocumentIsolated(resolved, "pdf");
    text = result.text;
    pages = result.pages?.map((page) => ({ page: page.page, text: normalizeExtractedText(page.text) }));
    warnings.push(...result.warnings);
    format = "pdf";
  } else if (extension === ".docx") {
    const result = await parseDocumentIsolated(resolved, "docx");
    text = result.text;
    warnings.push(...result.warnings);
    format = "docx";
  } else {
    throw new ProsperoError({
      code: "VALIDATION_ERROR",
      message: `Unsupported protocol format: ${extension || "no extension"}.`,
      retryable: false,
      action: "Use TXT, MD, PDF or DOCX.",
    });
  }

  text = normalizeExtractedText(text);
  if (text.length < 50) warnings.push("Very little text was extracted; the document may be scanned or image-only.");
  return { source: "file", path: resolved, format, text, characters: text.length, warnings, ...(pages ? { pages } : {}) };
}

export function extractProtocolCandidates(protocol: LoadedProtocol): Record<string, string> {
  const sections = splitProtocolSections(protocol.text);
  const candidates: Record<string, string> = {};
  for (const field of REGISTRATION_CATALOG) {
    const matches = sections.filter((section) =>
      field.protocol_headings.some((heading) => section.heading.toLowerCase().includes(heading)),
    );
    if (matches.length > 0) candidates[field.key] = matches.map((match) => match.content).join("\n\n").slice(0, 12_000);
  }
  return candidates;
}

export function renderRegistrationWorkbook(
  protocol: LoadedProtocol,
  answers: Record<string, string>,
): string {
  const lines = [
    "# PROSPERO Registration Workbook (generated)",
    "",
    `- Generated: ${new Date().toISOString()}`,
    `- Protocol source: ${protocol.path ?? "provided text"}`,
    `- Format: ${protocol.format}`,
    "- Status: draft only; every answer requires human confirmation before website entry.",
    "",
  ];
  let currentSection = "";
  for (const field of REGISTRATION_CATALOG) {
    if (field.section !== currentSection) {
      currentSection = field.section;
      lines.push(`# ${currentSection}`, "");
    }
    const proposed = answers[field.key]?.trim() ?? "";
    const constraint = REGISTRATION_CONSTRAINTS_BY_KEY.get(field.key);
    const wordLimit = constraint && (constraint.minimum_words !== null || constraint.maximum_words !== null)
      ? `${constraint.minimum_words ?? 0}-${constraint.maximum_words ?? "unlimited"} words`
      : "not specified in snapshot";
    lines.push(
      `## ${field.title}`,
      "",
      `- Key: \`${field.key}\``,
      `- Automation: \`${field.automation}\``,
      `- Required in ${REGISTRATION_SCHEMA_SNAPSHOT_META.template_variant} snapshot: ${constraint?.required ? "yes" : "no"}`,
      `- Word limit snapshot: ${wordLimit}`,
      `- Status: ${proposed ? "candidate extracted; confirm and edit" : "not found in protocol"}`,
      "",
      "```text",
      proposed,
      "```",
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

export function defaultWorkbookOutputPath(protocol: LoadedProtocol): string {
  if (protocol.path) {
    const extension = path.extname(protocol.path);
    return path.join(path.dirname(protocol.path), `${path.basename(protocol.path, extension)}.prospero-workbook.md`);
  }
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, "..", "prospero-generated-workbook.md");
}

function splitProtocolSections(text: string): Array<{ heading: string; content: string }> {
  const lines = text.split(/\r?\n/);
  const sections: Array<{ heading: string; content: string }> = [];
  let heading = "document";
  let content: string[] = [];
  const flush = () => {
    const value = content.join("\n").trim();
    if (value) sections.push({ heading: heading.toLowerCase(), content: value });
    content = [];
  };
  for (const line of lines) {
    const markdown = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/);
    const plain = line.match(/^\s*([A-Z][A-Za-z /()-]{2,80})\s*:\s*$/);
    if (markdown || plain) {
      flush();
      heading = (markdown?.[1] ?? plain?.[1] ?? "document").trim();
    } else {
      content.push(line);
    }
  }
  flush();
  if (sections.length === 0 && text.trim()) sections.push({ heading: "document", content: text.trim() });
  return sections;
}

function normalizeExtractedText(value: string): string {
  return value.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
}
