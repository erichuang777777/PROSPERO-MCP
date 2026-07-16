#!/usr/bin/env node
import "dotenv/config";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { atomicWriteFileSync } from "./atomic-file.js";
import { resolveConfig } from "./config.js";
import { normalizeProsperoError } from "./errors.js";
import { ProsperoClient } from "./prospero-client.js";
import { PubMedClient } from "./pubmed-client.js";
import { analyzeRegistrationFields, buildMissingInformationInterview } from "./registration-assistant.js";
import { loadProtocol, extractProtocolCandidates, renderRegistrationWorkbook } from "./protocol.js";
import { discoverProtocolSimilarReviews } from "./protocol-pipeline.js";
import { validateRegistration } from "./registration-validator.js";
import { assertAllowedOutputPath, assertAllowedProtocolPath, describeSafetyPolicy } from "./safety-policy.js";

const prospero = new ProsperoClient(resolveConfig());
const pubmed = new PubMedClient();

async function main(): Promise<void> {
  const [command = "help", ...tokens] = process.argv.slice(2);
  const args = parseArgs(tokens);
  switch (command) {
    case "health": return emit({ version: "0.2.0", safety: describeSafetyPolicy(), network_mode: process.env.PROSPERO_NETWORK_MODE ?? "offline" });
    case "search": return emit(await prospero.search({
      query: positional(args, 0, "Search query is required."), field: option(args, "field") as "ALL" | "TI" | "AN" | undefined,
      page: integerOption(args, "page"), page_size: integerOption(args, "page-size"), review_status: listOption(args, "status"),
      year_in_prospero: listOption(args, "year"), record_type: listOption(args, "type"), sort: option(args, "sort") as "title" | "accession" | "year" | undefined,
      sort_order: option(args, "order") as "asc" | "desc" | undefined,
    }));
    case "get": return emit(await (await import("./prospero-page.js")).fetchProsperoRecordPage(positional(args, 0, "A CRD accession number is required.")));
    case "similar": return emit(await prospero.checkSimilarReviews({
      title: requiredOption(args, "title"), review_question: requiredOption(args, "question"), condition: option(args, "condition"),
      intervention: option(args, "intervention"), comparator: option(args, "comparator"), outcomes: option(args, "outcomes"),
    }));
    case "protocol": return protocolCommand(args);
    case "validate": return validateCommand(args);
    case "template": return templateCommand(args);
    case "list-drafts": return emit(await (await import("./prospero-page.js")).listProsperoDrafts());
    case "schema": return emit(await (await import("./prospero-page.js")).fetchProsperoRegistrationSchema({
      record_id: integerOption(args, "record-id"), record_version_id: option(args, "record-version-id"), title: option(args, "title"),
    }, { include_details: flag(args, "details"), max_detail_fields: integerOption(args, "max-fields") ?? 39 }));
    case "help": case "--help": case "-h": return printHelp();
    default: throw new CliUsageError(`Unknown command: ${command}`);
  }
}

async function protocolCommand(args: ParsedArgs): Promise<void> {
  const protocol = await loadProtocol({ protocol_path: positional(args, 0, "Protocol TXT, MD, PDF or DOCX path is required.") });
  const candidates = extractProtocolCandidates(protocol);
  const manifest = analyzeRegistrationFields(protocol, candidates, {}, []);
  const workbook = renderRegistrationWorkbook(protocol, candidates);
  const output = option(args, "output");
  const outputPath = output ? assertAllowedOutputPath(output) : null;
  if (outputPath) atomicWriteFileSync(outputPath, workbook, { encoding: "utf8" });
  let discovery: unknown;
  if (flag(args, "search")) discovery = await discoverProtocolSimilarReviews(protocol, candidates, prospero, pubmed, {
    includePubMed: option(args, "pubmed") !== "false", maxProspero: integerOption(args, "max-prospero"), maxPubMed: integerOption(args, "max-pubmed"),
    requireExternalConfirmation: true, externalConfirmationHash: option(args, "confirm"),
  });
  emit({ protocol: { source: protocol.source, path: protocol.path, format: protocol.format, characters: protocol.characters, warnings: protocol.warnings }, candidate_fields: candidates, manifest, missing_information: buildMissingInformationInterview(manifest), workbook_path: outputPath, workbook: flag(args, "include-workbook") ? workbook : undefined, discovery });
}

function validateCommand(args: ParsedArgs): void {
  const input = assertAllowedProtocolPath(positional(args, 0, "Answers JSON path is required."));
  emit(validateRegistration(JSON.parse(readFileSync(input, "utf8")) as Record<string, unknown>, undefined, { require_complete: flag(args, "complete") }));
}

function templateCommand(args: ParsedArgs): void {
  const content = readFileSync(fileURLToPath(new URL("../templates/PROSPERO_PROTOCOL_TEMPLATE.md", import.meta.url)), "utf8");
  const output = option(args, "output");
  if (output) { const safe = assertAllowedOutputPath(output); atomicWriteFileSync(safe, content, { encoding: "utf8" }); emit({ output_path: safe }); }
  else process.stdout.write(content);
}

interface ParsedArgs { positional: string[]; options: Map<string, string | true>; }
function parseArgs(tokens: string[]): ParsedArgs {
  const parsed: ParsedArgs = { positional: [], options: new Map() };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!token.startsWith("--")) { parsed.positional.push(token); continue; }
    const [rawKey, inline] = token.slice(2).split("=", 2);
    if (!rawKey) throw new CliUsageError("Empty option name.");
    if (inline !== undefined) parsed.options.set(rawKey, inline);
    else if (tokens[index + 1] && !tokens[index + 1]!.startsWith("--")) parsed.options.set(rawKey, tokens[++index]!);
    else parsed.options.set(rawKey, true);
  }
  return parsed;
}
function option(args: ParsedArgs, name: string): string | undefined { const value = args.options.get(name); return typeof value === "string" ? value : undefined; }
function requiredOption(args: ParsedArgs, name: string): string { const value = option(args, name); if (!value) throw new CliUsageError(`--${name} is required.`); return value; }
function integerOption(args: ParsedArgs, name: string): number | undefined { const value = option(args, name); if (!value) return undefined; const parsed = Number.parseInt(value, 10); if (!Number.isFinite(parsed) || parsed < 1) throw new CliUsageError(`--${name} must be a positive integer.`); return parsed; }
function listOption(args: ParsedArgs, name: string): string[] | undefined { const value = option(args, name); return value ? value.split(",").map((item) => item.trim()).filter(Boolean) : undefined; }
function flag(args: ParsedArgs, name: string): boolean { return args.options.get(name) === true || option(args, name) === "true"; }
function positional(args: ParsedArgs, index: number, message: string): string { const value = args.positional[index]; if (!value) throw new CliUsageError(message); return value; }
function emit(data: unknown): void { process.stdout.write(`${JSON.stringify({ ok: true, data }, null, 2)}\n`); }
function printHelp(): void { process.stdout.write(`prospero — safe PROSPERO MCP companion CLI\n\nCommands:\n  health\n  search <query> [--status Ongoing] [--year 2025,2026] [--type Clinical]\n  get <CRD accession>\n  similar --title <title> --question <question> [PICO options]\n  protocol <file> [--output workbook.md] [--search --confirm <sha256>]\n  validate <answers.json> [--complete]\n  template [--output protocol.md]\n  list-drafts\n  schema [--record-id N | --record-version-id UUID | --title text] [--details]\n\nMachine-readable commands emit {ok:true,data}; errors use structured stderr and stable exit codes.\nProtocol-derived external searches require two calls: first review the query plan, then repeat with --confirm.\nNo CLI command can submit, mark complete, delete, withdraw, release, or approve a record.\n`); }

class CliUsageError extends Error {}
const EXIT_CODES: Record<string, number> = { CONFIG_ERROR: 2, VALIDATION_ERROR: 3, AUTH_REQUIRED: 4, AUTH_EXPIRED: 4, NETWORK_TIMEOUT: 5, NETWORK_ERROR: 5, SITE_UNAVAILABLE: 5, HTTP_ERROR: 5, WRITE_DISABLED: 6, WRITE_CONFIRMATION_REQUIRED: 6 };
main().catch((error) => {
  const normalized = error instanceof CliUsageError ? { code: "CLI_USAGE", message: error.message, retryable: false, action: "Run prospero help." } : normalizeProsperoError(error).toJSON();
  process.stderr.write(`${JSON.stringify({ ok: false, error: normalized }, null, 2)}\n`);
  process.exitCode = error instanceof CliUsageError ? 2 : EXIT_CODES[normalized.code] ?? 1;
});
