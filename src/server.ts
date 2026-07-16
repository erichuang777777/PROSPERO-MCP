#!/usr/bin/env node
import "dotenv/config";

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { resolveConfig } from "./config.js";
import { getProsperoSessionStatus, resolveBrowserPath } from "./prospero-browser.js";
import { normalizeProsperoError } from "./errors.js";
import {
  defaultWorkbookOutputPath,
  extractProtocolCandidates,
  loadProtocol,
  renderRegistrationWorkbook,
} from "./protocol.js";
import { validateRegistration } from "./registration-validator.js";
import { findCatalogField } from "./registration-catalog.js";
import {
  assertWritesEnabled,
  assertPreparedPatchReceipt,
  consumePreparedPatchReceipt,
  createRegistrationPatch,
  storePreparedPatchReceipt,
  verifyRegistrationPatch,
  type RegistrationPatch,
} from "./registration-patch.js";
import { writeRegistrationAudit } from "./audit.js";
import {
  buildProsperoPicoQuery,
  bulkSearch,
  compareSimilarReviews,
  exportSearchHits,
  rankSearchHits,
} from "./search-automation.js";
import { ProsperoClient } from "./prospero-client.js";
import { PubMedClient } from "./pubmed-client.js";
import { discoverProtocolSimilarReviews, type ProtocolSearchConcepts } from "./protocol-pipeline.js";
import { analyzeRegistrationFields, buildMissingInformationInterview, type RegistrationAnalysisManifest } from "./registration-assistant.js";
import {
  compareRegistrationVersions,
  compareSimilarSnapshot,
  copyConfirmedQueueField,
  prepareClipboardQueue,
  renderRegistrationPreview,
  validateAdvancedConsistency,
  validateSearchStrategy,
  writePreviewFile,
} from "./safe-automation.js";
import { assertAllowedOutputPath, describeSafetyPolicy } from "./safety-policy.js";
import { protectLocalArtifact, prepareProtectedArtifactRead, readProtectedLocalArtifact } from "./protected-artifact.js";
import { atomicWriteFileSync, withFileLock } from "./atomic-file.js";
import type {
  ProsperoSearchArgs,
  ProsperoRecordWorkflowMode,
  ProsperoSimilarReviewInput,
} from "./types.js";

const config = resolveConfig();
const client = new ProsperoClient(config);
const pubmedClient = new PubMedClient({ timeoutMs: readPositiveInteger(process.env.PUBMED_TIMEOUT_MS, 15_000) });

const server = new McpServer({
  name: "prospero-mcp",
  version: "0.2.0",
});
const registeredTools = new Map<string, RegisteredTool>();
const originalRegisterTool = server.registerTool.bind(server) as (...args: unknown[]) => RegisteredTool;
server.registerTool = ((...args: unknown[]) => {
  const handle = originalRegisterTool(...args);
  registeredTools.set(String(args[0]), handle);
  return handle;
}) as typeof server.registerTool;

server.registerTool(
  "prospero_health",
  {
    title: "PROSPERO Health",
    description: "Return the configured PROSPERO API base URL and runtime settings.",
  },
  async () => {
    const browserAvailable = await resolveBrowserPath().then(() => true).catch(() => false);
    const session = getProsperoSessionStatus();
    const sessionCaptured = session.state === "present" && session.user_identity_present;
    return ok({
      healthy: true,
      base_url: config.baseUrl,
      timeout_ms: config.timeoutMs,
      browser_available: browserAvailable,
      login_session_captured: sessionCaptured,
      login_session: session,
      setup_complete: browserAvailable && sessionCaptured,
      writes_enabled: process.env.PROSPERO_ENABLE_WRITES === "true",
      pubmed: {
        enabled: process.env.PUBMED_ENABLED !== "false",
        api_key_configured: Boolean(process.env.NCBI_API_KEY),
        api_key_required: false,
        timeout_ms: readPositiveInteger(process.env.PUBMED_TIMEOUT_MS, 15_000),
      },
      safety_policy: describeSafetyPolicy(),
      next_step: !browserAvailable
        ? "Install Chrome/Edge or set PROSPERO_BROWSER_PATH."
        : !sessionCaptured
          ? "Run npm run setup:prospero."
          : "Ready.",
      access_token_configured: config.accessToken.length > 0,
      auth_token_configured: typeof config.authToken === "string" && config.authToken.length > 0,
    });
  },
);

server.registerTool(
  "prospero_search_protocols",
  {
    title: "Search PROSPERO Protocols",
    description:
      "Search already-registered PROSPERO protocols by free-text query. Supports the site syntax: phrases, Boolean operators, wildcards, proximity, and field codes.",
    inputSchema: z.object({
      query: z.string().min(1).max(500).describe("Search text or PROSPERO query syntax."),
      page: z.number().int().min(1).max(1000).default(1).optional(),
      page_size: z.number().int().min(1).max(50).default(20).optional(),
      field: z
        .enum(["ALL", "TI", "AN", "RQ", "CS", "IV", "OP", "PA", "KW", "CM", "CO", "FU", "OA", "OS"])
        .default("ALL")
        .optional(),
      sort: z.enum(["title", "accession", "year"]).default("title").optional(),
      sort_order: z.enum(["asc", "desc"]).default("asc").optional(),
      filters: z
        .array(
          z.object({
            name: z.enum([
              "recordtype",
              "reviewstatus",
              "dateinprospero",
              "yearfirstpublished",
              "region",
              "funders",
            ]),
            value: z.array(z.string().min(1)).min(1),
          }),
        )
        .optional(),
      record_type: z.array(z.enum(["Animal", "Clinical", "Cochrane"])).optional(),
      review_status: z.array(z.enum(["Completed", "Discontinued", "Ongoing"])).optional(),
      year_in_prospero: z.array(z.string()).optional(),
      date_registered_start: z.string().optional(),
      date_registered_end: z.string().optional(),
      response_mode: z.enum(["summary", "standard", "full"]).optional(),
    }),
  },
  async (args) => safe(() => runSearch(args), args.response_mode),
);

server.registerTool(
  "prospero_prepare_registration_patch",
  {
    title: "Prepare PROSPERO Registration Patch",
    description:
      "Create a read-only old/new dry-run for selected registration fields, with provenance, confidence and a confirmation hash. No website data is changed.",
    inputSchema: z.object({
      record_id: z.number().int().positive().optional(),
      record_version_id: z.string().uuid().optional(),
      title: z.string().min(1).max(500).optional(),
      proposed_answers: z.record(z.string(), z.string()).refine((value) => Object.keys(value).length > 0, { message: "At least one proposed answer is required." }),
      provenance: z.record(z.string(), z.string()).optional(),
      confidence: z.record(z.string(), z.enum(["low", "medium", "high"])).optional(),
    }),
  },
  async (args) => safe(async () => {
    const titles = Object.keys(args.proposed_answers).map((key) => findCatalogField(key)?.title ?? key);
    const schema = await fetchProsperoRegistrationSchema({
      record_id: args.record_id,
      record_version_id: args.record_version_id,
      title: args.title,
    }, {
      include_details: true,
      max_detail_fields: titles.length,
      detail_field_titles: titles,
    });
    const patch = createRegistrationPatch(
      schema.draft,
      schema,
      args.proposed_answers,
      args.provenance ?? {},
      args.confidence ?? {},
    );
    const receiptPath = storePreparedPatchReceipt(patch);
    return { ...patch, local_receipt_path: receiptPath };
  }),
);

const registrationPatchSchema = z.object({
  version: z.literal(1),
  mode: z.literal("save_for_later_only"),
  draft: z.object({
    record_id: z.number().int().positive(),
    record_version_id: z.string().uuid(),
    title: z.string(),
    last_edited_at: z.string(),
  }),
  created_at: z.string(),
  changes: z.array(z.object({
    key: z.string(),
    title: z.string(),
    route: z.string().startsWith("/PROSPERO/register/"),
    current_value: z.string(),
    new_value: z.string(),
    changed: z.boolean(),
    provenance: z.string(),
    confidence: z.enum(["low", "medium", "high"]),
  })).min(1),
  confirmation_hash: z.string().regex(/^[a-f0-9]{64}$/),
});

server.registerTool(
  "prospero_apply_registration_patch",
  {
    title: "Apply Guarded PROSPERO Save-for-Later Patch",
    description:
      "Apply explicitly allowed dry-run fields and click only Save for later. Disabled unless PROSPERO_ENABLE_WRITES=true. Never marks complete, submits, deletes or approves a record.",
    inputSchema: z.object({
      patch: registrationPatchSchema,
      confirmation_hash: z.string().regex(/^[a-f0-9]{64}$/),
      allowed_fields: z.array(z.string()).min(1),
    }),
  },
  async (args) => safe(async () => {
    assertWritesEnabled();
    const patch = args.patch as RegistrationPatch;
    verifyRegistrationPatch(patch, args.confirmation_hash);
    const lockPath = path.resolve(process.env.PROSPERO_LOCK_DIR ?? ".prospero-locks", `draft-${patch.draft.record_version_id}.lock`);
    return withFileLock(lockPath, async () => {
      assertPreparedPatchReceipt(patch);
      const outcomes = await applyProsperoRegistrationPatch(patch, args.allowed_fields);
      const auditPath = writeRegistrationAudit(patch, outcomes);
      consumePreparedPatchReceipt(patch);
      return { mode: "save_for_later_only", outcomes, audit_path: auditPath, prohibited_actions_invoked: [] };
    });
  }),
);

server.registerTool(
  "prospero_build_query",
  {
    title: "Build PROSPERO PICO Query",
    description: "Build a reproducible Boolean PROSPERO search query from PICO concept groups.",
    inputSchema: z.object({
      population: z.array(z.string().min(1)).optional(),
      condition: z.array(z.string().min(1)).optional(),
      intervention: z.array(z.string().min(1)).optional(),
      comparator: z.array(z.string().min(1)).optional(),
      outcomes: z.array(z.string().min(1)).optional(),
      additional: z.array(z.string().min(1)).optional(),
      fielded: z.boolean().default(false).optional(),
    }),
  },
  async (args) => safe(async () => ({
    query: buildProsperoPicoQuery(args),
    fielded: args.fielded ?? false,
    note: "Fielded queries are more selective; verify field codes against the current PROSPERO search behaviour.",
  })),
);

server.registerTool(
  "prospero_bulk_export",
  {
    title: "Bulk Search and Export PROSPERO Records",
    description: "Retrieve up to 500 public search hits and export them as JSON, CSV or RIS.",
    inputSchema: z.object({
      query: z.string().min(1).max(500),
      field: z.enum(["ALL", "TI", "AN", "RQ", "CS", "IV", "OP", "PA", "KW", "CM", "CO", "FU", "OA", "OS"]).default("ALL").optional(),
      record_type: z.array(z.enum(["Animal", "Clinical", "Cochrane"])).optional(),
      review_status: z.array(z.enum(["Completed", "Discontinued", "Ongoing"])).optional(),
      year_in_prospero: z.array(z.string()).optional(),
      max_records: z.number().int().min(1).max(500).default(100).optional(),
      format: z.enum(["json", "csv", "ris"]).default("json"),
      relevance_concepts: z.array(z.string().min(1)).optional(),
      output_path: z.string().min(1).max(2_000).optional(),
      response_mode: z.enum(["summary", "standard", "full"]).optional(),
    }),
  },
  async (args) => safe(async () => {
    const result = await bulkSearch(client, {
      query: args.query,
      field: args.field,
      record_type: args.record_type,
      review_status: args.review_status,
      year_in_prospero: args.year_in_prospero,
      sort: "title",
      sort_order: "asc",
    }, args.max_records ?? 100);
    const hits = args.relevance_concepts?.length
      ? rankSearchHits(result.hits, args.relevance_concepts)
      : result.hits;
    const exported = exportSearchHits(hits, args.format);
    const outputPath = args.output_path ? assertAllowedOutputPath(args.output_path) : null;
    if (outputPath) await writeFile(outputPath, exported, "utf8");
    return {
      query: args.query,
      total_hits: result.pages[0]?.total_hits ?? 0,
      exported_records: hits.length,
      format: args.format,
      output_path: outputPath,
      content: exported,
      relevance_note: args.relevance_concepts?.length
        ? "Lexical relevance ranking was applied within the retrieved candidate set."
        : null,
    };
  }, args.response_mode),
);

server.registerTool(
  "prospero_compare_similar_reviews",
  {
    title: "Compare Similar PROSPERO Reviews",
    description: "Run the PROSPERO similar-review endpoint and draft traceable scope-difference notes from PICO concepts.",
    inputSchema: z.object({
      title: z.string().min(1).max(500),
      review_question: z.string().min(1).max(2_000),
      population: z.array(z.string().min(1)).optional(),
      condition: z.array(z.string().min(1)).optional(),
      intervention: z.array(z.string().min(1)).optional(),
      comparator: z.array(z.string().min(1)).optional(),
      outcomes: z.array(z.string().min(1)).optional(),
      threshold: z.number().min(0).max(1).default(0.4).optional(),
    }),
  },
  async (args) => safe(async () => {
    const reviews = await client.checkSimilarReviews({
      title: args.title,
      review_question: args.review_question,
      condition: [...(args.population ?? []), ...(args.condition ?? [])].join("; "),
      intervention: (args.intervention ?? []).join("; "),
      comparator: (args.comparator ?? []).join("; "),
      outcomes: (args.outcomes ?? []).join("; "),
      threshold: args.threshold ?? 0.4,
    });
    return {
      count: reviews.length,
      comparisons: compareSimilarReviews(args, reviews),
      warning: "Difference rationales are drafts based on indexed text. Review the full records before making the final similarity decision.",
    };
  }),
);

server.registerTool(
  "prospero_generate_workbook",
  {
    title: "Generate PROSPERO Registration Workbook",
    description:
      "Read protocol text or a local TXT/MD/PDF/DOCX file, extract candidate registration content, and generate a 39-field Markdown workbook. No website data is changed.",
    inputSchema: z.object({
      protocol_text: z.string().min(1).max(2_000_000).optional(),
      protocol_path: z.string().min(1).max(2_000).optional(),
      confirmed_answers: z.record(z.string(), z.string()).optional(),
      write_file: z.boolean().default(false).optional(),
      output_path: z.string().min(1).max(2_000).optional(),
    }).refine(
      (value) => Boolean(value.protocol_text) !== Boolean(value.protocol_path),
      { message: "Provide exactly one of protocol_text or protocol_path." },
    ),
  },
  async (args) => safe(async () => {
    const protocol = await loadProtocol({
      protocol_text: args.protocol_text,
      protocol_path: args.protocol_path,
    });
    const candidates = extractProtocolCandidates(protocol);
    const answers = { ...candidates, ...(args.confirmed_answers ?? {}) };
    const workbook = renderRegistrationWorkbook(protocol, answers);
    let outputPath: string | null = null;
    if (args.write_file) {
      outputPath = assertAllowedOutputPath(args.output_path ?? defaultWorkbookOutputPath(protocol));
      await writeFile(outputPath, workbook, "utf8");
    }
    return {
      protocol: {
        source: protocol.source,
        path: protocol.path,
        format: protocol.format,
        characters: protocol.characters,
        warnings: protocol.warnings,
      },
      candidate_field_count: Object.keys(candidates).length,
      candidate_fields: candidates,
      workbook,
      output_path: outputPath,
    };
  }),
);

server.registerTool(
  "prospero_protocol_to_registration",
  {
    title: "Protocol to PROSPERO Registration and Similar Reviews",
    description:
      "Generate a 39-field registration workbook from a protocol, then search PROSPERO and optionally PubMed for similar reviews. PubMed has no required API key and degrades safely when disabled, empty or unavailable.",
    inputSchema: z.object({
      protocol_text: z.string().min(1).max(2_000_000).optional(),
      protocol_path: z.string().min(1).max(2_000).optional(),
      confirmed_answers: z.record(z.string(), z.string()).optional(),
      search_concepts: z.object({
        title: z.string().min(1).max(500).optional(),
        population: z.array(z.string().min(1).max(200)).max(20).optional(),
        condition: z.array(z.string().min(1).max(200)).max(20).optional(),
        intervention: z.array(z.string().min(1).max(200)).max(20).optional(),
        comparator: z.array(z.string().min(1).max(200)).max(20).optional(),
        outcomes: z.array(z.string().min(1).max(200)).max(20).optional(),
        additional: z.array(z.string().min(1).max(200)).max(20).optional(),
      }).optional(),
      include_pubmed: z.boolean().optional(),
      external_query_confirmation_hash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
      max_prospero: z.number().int().min(1).max(100).default(25).optional(),
      max_pubmed: z.number().int().min(1).max(100).default(25).optional(),
      write_workbook: z.boolean().default(false).optional(),
      workbook_output_path: z.string().min(1).max(2_000).optional(),
      response_mode: z.enum(["summary", "standard", "full"]).optional(),
    }).refine(
      (value) => Boolean(value.protocol_text) !== Boolean(value.protocol_path),
      { message: "Provide exactly one of protocol_text or protocol_path." },
    ),
  },
  async (args) => safe(async () => {
    const protocol = await loadProtocol({ protocol_text: args.protocol_text, protocol_path: args.protocol_path });
    const candidates = extractProtocolCandidates(protocol);
    const answers = { ...candidates, ...(args.confirmed_answers ?? {}) };
    const workbook = renderRegistrationWorkbook(protocol, answers);
    let workbookOutputPath: string | null = null;
    if (args.write_workbook) {
      workbookOutputPath = assertAllowedOutputPath(args.workbook_output_path ?? defaultWorkbookOutputPath(protocol));
      await writeFile(workbookOutputPath, workbook, "utf8");
    }
    const includePubMed = args.include_pubmed ?? process.env.PUBMED_ENABLED !== "false";
    const discovery = await discoverProtocolSimilarReviews(protocol, answers, client, pubmedClient, {
      includePubMed,
      maxProspero: args.max_prospero ?? 25,
      maxPubMed: args.max_pubmed ?? 25,
      conceptOverrides: definedConceptOverrides(args.search_concepts),
      requireExternalConfirmation: true,
      externalConfirmationHash: args.external_query_confirmation_hash,
    });
    return {
      protocol: {
        source: protocol.source,
        path: protocol.path,
        format: protocol.format,
        characters: protocol.characters,
        warnings: protocol.warnings,
      },
      candidate_field_count: Object.keys(candidates).length,
      candidate_fields: candidates,
      validation: validateRegistration(answers, undefined, { require_complete: false }),
      workbook,
      workbook_output_path: workbookOutputPath,
      similar_reviews: discovery,
      manual_confirmation_required: [
        "Final similar-review classification and reason for proceeding",
        "Timeline and current review stage",
        "Team, funding, peer review and conflict-of-interest declarations",
        "Any method not explicitly stated in the protocol",
      ],
    };
  }, args.response_mode),
);

server.registerTool(
  "prospero_analyze_protocol",
  {
    title: "Analyze Protocol Provenance and Missing Information",
    description: "Create claim-level provenance, confidence, field states, missing-information questions and advanced consistency findings without network or website writes.",
    inputSchema: z.object({
      protocol_text: z.string().min(1).max(2_000_000).optional(),
      protocol_path: z.string().min(1).max(2_000).optional(),
      answers: z.record(z.string(), z.string()).optional(),
      confirmed_keys: z.array(z.string()).default([]).optional(),
      previous_manifest: z.unknown().optional(),
      response_mode: z.enum(["summary", "standard", "full"]).optional(),
    }).refine((value) => Boolean(value.protocol_text) !== Boolean(value.protocol_path), { message: "Provide exactly one protocol source." }),
  },
  async (args) => safe(async () => {
    const protocol = await loadProtocol({ protocol_text: args.protocol_text, protocol_path: args.protocol_path });
    const extracted = extractProtocolCandidates(protocol);
    const answers = { ...extracted, ...(args.answers ?? {}) };
    const manifest = analyzeRegistrationFields(protocol, extracted, answers, args.confirmed_keys ?? [], args.previous_manifest as RegistrationAnalysisManifest | undefined);
    return {
      manifest,
      interview: buildMissingInformationInterview(manifest),
      registration_validation: validateRegistration(answers, undefined, { require_complete: false }),
      advanced_consistency: validateAdvancedConsistency(answers),
    };
  }, args.response_mode),
);

server.registerTool(
  "prospero_validate_search_strategy",
  {
    title: "Validate Search Strategy",
    description: "Locally lint Boolean structure, concept coverage, dangerous NOT use, controlled vocabulary and PubMed/Ovid syntax mismatches. This is not peer review.",
    inputSchema: z.object({
      strategy: z.string().min(1).max(500_000),
      platform: z.string().max(100).optional(),
      concepts: z.record(z.string(), z.array(z.string())).optional(),
    }),
  },
  async (args) => safe(async () => ({ findings: validateSearchStrategy(args.strategy, args.concepts ?? {}, args.platform), disclaimer: "Automated lint only; it does not constitute PRESS or independent peer review." })),
);

server.registerTool(
  "prospero_compare_protocol_versions",
  {
    title: "Compare Protocol Versions",
    description: "Compare two protocol versions by stable registration field and flag possible method changes or major-revision candidates. No website data is changed.",
    inputSchema: z.object({
      old_protocol_text: z.string().min(1).max(2_000_000).optional(),
      old_protocol_path: z.string().min(1).max(2_000).optional(),
      new_protocol_text: z.string().min(1).max(2_000_000).optional(),
      new_protocol_path: z.string().min(1).max(2_000).optional(),
    }).refine((value) => Boolean(value.old_protocol_text) !== Boolean(value.old_protocol_path), { message: "Provide exactly one old protocol source." })
      .refine((value) => Boolean(value.new_protocol_text) !== Boolean(value.new_protocol_path), { message: "Provide exactly one new protocol source." }),
  },
  async (args) => safe(async () => {
    const [oldProtocol, newProtocol] = await Promise.all([
      loadProtocol({ protocol_text: args.old_protocol_text, protocol_path: args.old_protocol_path }),
      loadProtocol({ protocol_text: args.new_protocol_text, protocol_path: args.new_protocol_path }),
    ]);
    return compareRegistrationVersions(extractProtocolCandidates(oldProtocol), extractProtocolCandidates(newProtocol));
  }),
);

server.registerTool(
  "prospero_generate_local_preview",
  {
    title: "Generate Local PROSPERO Preview",
    description: "Render a local HTML preview with field states, word counts and provenance. It never opens or writes to PROSPERO.",
    inputSchema: z.object({
      protocol_text: z.string().min(1).max(2_000_000).optional(),
      protocol_path: z.string().min(1).max(2_000).optional(),
      answers: z.record(z.string(), z.string()).optional(),
      confirmed_keys: z.array(z.string()).default([]).optional(),
      output_path: z.string().min(1).max(2_000).optional(),
    }).refine((value) => Boolean(value.protocol_text) !== Boolean(value.protocol_path), { message: "Provide exactly one protocol source." }),
  },
  async (args) => safe(async () => {
    const protocol = await loadProtocol({ protocol_text: args.protocol_text, protocol_path: args.protocol_path });
    const extracted = extractProtocolCandidates(protocol);
    const manifest = analyzeRegistrationFields(protocol, extracted, { ...extracted, ...(args.answers ?? {}) }, args.confirmed_keys ?? []);
    const html = renderRegistrationPreview(manifest);
    return { html, output_path: args.output_path ? writePreviewFile(args.output_path, html) : null, blocking_fields: manifest.blocking_fields };
  }),
);

server.registerTool(
  "prospero_prepare_clipboard_queue",
  {
    title: "Prepare Confirmed Clipboard Queue",
    description: "Create a local single-use queue containing only explicitly confirmed, non-declaration fields. It does not copy or write to PROSPERO.",
    inputSchema: z.object({
      protocol_text: z.string().min(1).max(2_000_000).optional(),
      protocol_path: z.string().min(1).max(2_000).optional(),
      answers: z.record(z.string(), z.string()),
      confirmed_keys: z.array(z.string()).min(1),
    }).refine((value) => Boolean(value.protocol_text) !== Boolean(value.protocol_path), { message: "Provide exactly one protocol source." }),
  },
  async (args) => safe(async () => {
    const protocol = await loadProtocol({ protocol_text: args.protocol_text, protocol_path: args.protocol_path });
    const extracted = extractProtocolCandidates(protocol);
    const manifest = analyzeRegistrationFields(protocol, extracted, { ...extracted, ...args.answers }, args.confirmed_keys);
    return prepareClipboardQueue(manifest);
  }),
);

server.registerTool(
  "prospero_copy_confirmed_field",
  {
    title: "Copy One Confirmed Field",
    description: "Copy one reviewed queue field to the local clipboard once. Declaration fields are never eligible and no browser interaction occurs.",
    inputSchema: z.object({ queue_id: z.string().regex(/^[a-f0-9]{64}$/), confirmation_hash: z.string().regex(/^[a-f0-9]{64}$/), key: z.string().min(1).max(100) }),
  },
  async (args) => safe(() => copyConfirmedQueueField(args.queue_id, args.key, args.confirmation_hash)),
);

server.registerTool(
  "prospero_monitor_similar_reviews",
  {
    title: "Monitor Similar Reviews",
    description: "Re-run read-only PROSPERO and optional PubMed discovery, compare identifiers with a local snapshot, and optionally update that snapshot.",
    inputSchema: z.object({
      protocol_text: z.string().min(1).max(2_000_000).optional(),
      protocol_path: z.string().min(1).max(2_000).optional(),
      snapshot_path: z.string().min(1).max(2_000),
      include_pubmed: z.boolean().default(true).optional(),
      external_query_confirmation_hash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
      update_snapshot: z.boolean().default(false).optional(),
      max_records: z.number().int().min(1).max(100).default(25).optional(),
    }).refine((value) => Boolean(value.protocol_text) !== Boolean(value.protocol_path), { message: "Provide exactly one protocol source." }),
  },
  async (args) => safe(async () => {
    const protocol = await loadProtocol({ protocol_text: args.protocol_text, protocol_path: args.protocol_path });
    const extracted = extractProtocolCandidates(protocol);
    const discovery = await discoverProtocolSimilarReviews(protocol, extracted, client, pubmedClient, { includePubMed: args.include_pubmed ?? true, maxProspero: args.max_records ?? 25, maxPubMed: args.max_records ?? 25, requireExternalConfirmation: true, externalConfirmationHash: args.external_query_confirmation_hash });
    const safeSnapshotPath = assertAllowedOutputPath(args.snapshot_path);
    const previous = existsSync(safeSnapshotPath) ? JSON.parse(await readFile(safeSnapshotPath, "utf8")) as { identifiers?: string[] } : {};
    const identifiers = discovery.combined_reviews.flatMap((review) => review.sources.map((source) => `${source.source}:${source.identifier}`));
    const comparison = compareSimilarSnapshot(previous.identifiers ?? [], identifiers);
    if (args.update_snapshot && discovery.external_query_plan.confirmed) atomicWriteFileSync(safeSnapshotPath, JSON.stringify({ version: 1, checked_at: new Date().toISOString(), identifiers, source_status: { prospero: discovery.sources.prospero.status, pubmed: discovery.sources.pubmed.status } }, null, 2), { encoding: "utf8" });
    return { comparison, discovery, snapshot_path: safeSnapshotPath, snapshot_updated: Boolean(args.update_snapshot && discovery.external_query_plan.confirmed), human_review_required: comparison.added.length > 0 };
  }),
);

server.registerTool(
  "prospero_protect_local_artifact",
  {
    title: "Protect Local Research Artifact",
    description: "Encrypt an allowlisted local protocol/workbook using Windows current-user DPAPI or AES-256-GCM on other platforms. No data is sent externally.",
    inputSchema: z.object({ input_path: z.string().min(1).max(2_000), output_path: z.string().min(1).max(2_000) }),
  },
  async (args) => safe(async () => protectLocalArtifact(args.input_path, args.output_path)),
);

server.registerTool(
  "prospero_read_protected_artifact",
  {
    title: "Read Protected Local Research Artifact",
    description: "Decrypt an allowlisted artifact under the same Windows user or local AES key. The plaintext is returned locally and is not written to disk.",
    inputSchema: z.object({ input_path: z.string().min(1).max(2_000), confirmation_hash: z.string().regex(/^[a-f0-9]{64}$/).optional() }),
  },
  async (args) => safe(async () => args.confirmation_hash ? readProtectedLocalArtifact(args.input_path, args.confirmation_hash) : prepareProtectedArtifactRead(args.input_path)),
);

server.registerTool(
  "prospero_validate_registration",
  {
    title: "Validate PROSPERO Registration Draft",
    description:
      "Validate a 39-field answer map for confirmed PROSPERO rules and methodological consistency. Optionally captures live field requirements for one draft.",
    inputSchema: z.object({
      answers: z.record(z.string(), z.unknown()),
      use_live_schema: z.boolean().default(false).optional(),
      require_complete: z.boolean().default(false).optional(),
      record_id: z.number().int().positive().optional(),
      record_version_id: z.string().uuid().optional(),
      title: z.string().min(1).max(500).optional(),
    }),
  },
  async (args) => safe(async () => {
    const schema = args.use_live_schema
      ? await fetchProsperoRegistrationSchema({
        record_id: args.record_id,
        record_version_id: args.record_version_id,
        title: args.title,
      }, { include_details: true, max_detail_fields: 39 })
      : undefined;
    return validateRegistration(args.answers, schema, { require_complete: args.require_complete ?? false });
  }),
);

server.registerTool(
  "prospero_list_drafts",
  {
    title: "List PROSPERO Drafts",
    description:
      "List every PROSPERO record visible to the signed-in user, including stable record and version identifiers. This is read-only.",
  },
  async () => safe(async () => {
    const drafts = await listProsperoDrafts();
    return {
      count: drafts.length,
      editable_count: drafts.filter((draft) => draft.editable).length,
      drafts,
    };
  }),
);

server.registerTool(
  "prospero_get_registration_schema",
  {
    title: "Get PROSPERO Registration Schema",
    description:
      "Read the live checklist for one selected editable draft. Optionally opens fields to capture current instructions, controls and word limits. This is read-only.",
    inputSchema: z.object({
      record_id: z.number().int().positive().optional(),
      record_version_id: z.string().uuid().optional(),
      title: z.string().min(1).max(500).optional(),
      include_details: z.boolean().default(false).optional(),
      max_detail_fields: z.number().int().min(0).max(100).default(39).optional(),
    }),
  },
  async (args) => safe(() => fetchProsperoRegistrationSchema(
    {
      record_id: args.record_id,
      record_version_id: args.record_version_id,
      title: args.title,
    },
    {
      include_details: args.include_details ?? false,
      max_detail_fields: args.max_detail_fields ?? 39,
    },
  )),
);

server.registerTool(
  "prospero_similar_reviews",
  {
    title: "Check Similar PROSPERO Reviews",
    description:
      "Run PROSPERO's Similar Reviews check using the record title and review question, plus optional PICO fields. Returns the nearby records and similarity scores.",
    inputSchema: z.object({
      recordversion: z.number().int().min(0).optional(),
      title: z.string().min(1).max(500),
      review_question: z.string().min(1).max(2000),
      condition: z.string().max(2000).optional(),
      intervention: z.string().max(2000).optional(),
      comparator: z.string().max(2000).optional(),
      outcomes: z.string().max(2000).optional(),
      threshold: z.number().min(0).max(1).default(0.4).optional(),
    }),
  },
  async (args) => {
    return safe(async () => {
      const result = await client.checkSimilarReviews(args as ProsperoSimilarReviewInput);
      return {
        count: result.length,
        results: result,
      };
    });
  },
);

server.registerTool(
  "prospero_get_protocol",
  {
    title: "Get PROSPERO Protocol",
    description:
      "Fetch a single protocol by PROSPERO accession number using the search index. This is the reliable single-record path for registered protocols.",
    inputSchema: z.object({
      accession_number: z.string().min(5).max(50).describe("Example: CRD420251016642"),
    }),
  },
  async (args) => {
    return safe(async () => {
      const result = await client.searchByAccession(args.accession_number);
      const exact = result.hits.find(
        (hit) => hit.accession_number.toUpperCase() === args.accession_number.trim().toUpperCase(),
      );
      return {
        accession_number: args.accession_number,
        found: exact != null,
        protocol: exact ?? result.hits[0] ?? null,
        search: result,
      };
    });
  },
);

server.registerTool(
  "prospero_record_workflow",
  {
    title: "PROSPERO Record Workflow",
    description:
      "Single entry point for existing-record capture, MyPROSPERO dashboard inspection, registration checklist extraction, and starting a new registration coversheet.",
    inputSchema: z.discriminatedUnion("mode", [
      z.object({
        mode: z.literal("view_record"),
        accession_number: z.string().min(5).max(50).describe("Example: CRD420251007996"),
      }),
      z.object({
        mode: z.literal("start_registration"),
      }),
      z.object({
        mode: z.literal("myprospero"),
      }),
      z.object({
        mode: z.literal("register_checklist"),
      }),
    ]),
  },
  async (args) => {
    return safe(async () => {
      if (args.mode === "view_record") {
        const record = await fetchProsperoRecordPage(args.accession_number);
        return { mode: args.mode, record };
      }

      if (args.mode === "myprospero") {
        const snapshot = await openProsperoMyProspero();
        return { mode: args.mode, page: snapshot };
      }

      if (args.mode === "register_checklist") {
        const checklist = await fetchProsperoRegisterChecklist();
        return { mode: args.mode, checklist };
      }

      const registration = await startProsperoRegistration();
      return { mode: args.mode, registration };
    });
  },
);

async function runSearch(args: ProsperoSearchArgs) {
  return client.search(args);
}

async function fetchProsperoRecordPage(...args: Parameters<typeof import("./prospero-page.js").fetchProsperoRecordPage>) { return (await import("./prospero-page.js")).fetchProsperoRecordPage(...args); }
async function fetchProsperoRegisterChecklist(...args: Parameters<typeof import("./prospero-page.js").fetchProsperoRegisterChecklist>) { return (await import("./prospero-page.js")).fetchProsperoRegisterChecklist(...args); }
async function fetchProsperoRegistrationSchema(...args: Parameters<typeof import("./prospero-page.js").fetchProsperoRegistrationSchema>) { return (await import("./prospero-page.js")).fetchProsperoRegistrationSchema(...args); }
async function applyProsperoRegistrationPatch(...args: Parameters<typeof import("./prospero-page.js").applyProsperoRegistrationPatch>) { return (await import("./prospero-page.js")).applyProsperoRegistrationPatch(...args); }
async function listProsperoDrafts(...args: Parameters<typeof import("./prospero-page.js").listProsperoDrafts>) { return (await import("./prospero-page.js")).listProsperoDrafts(...args); }
async function openProsperoMyProspero(...args: Parameters<typeof import("./prospero-page.js").openProsperoMyProspero>) { return (await import("./prospero-page.js")).openProsperoMyProspero(...args); }
async function startProsperoRegistration(...args: Parameters<typeof import("./prospero-page.js").startProsperoRegistration>) { return (await import("./prospero-page.js")).startProsperoRegistration(...args); }

type ResponseMode = "summary" | "standard" | "full";

function ok(data: unknown, requestedMode?: ResponseMode) {
  const mode = requestedMode ?? readResponseMode();
  const envelope = { ok: true, data: compactForResponse(data, mode), response_mode: mode };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(envelope, null, 2) }],
    structuredContent: envelope,
  };
}

async function safe(operation: () => Promise<unknown>, responseMode?: ResponseMode) {
  try {
    return ok(await operation(), responseMode);
  } catch (error) {
    const normalized = normalizeProsperoError(error);
    const envelope = { ok: false, error: normalized.toJSON() };
    return {
      isError: true,
      content: [{ type: "text" as const, text: JSON.stringify(envelope, null, 2) }],
      structuredContent: envelope,
    };
  }
}

function applyToolProfile(): void {
  const profile = (process.env.PROSPERO_TOOL_PROFILE ?? "authoring").toLowerCase();
  const enabled = profile === "full" ? null : profile === "core" ? CORE_TOOLS : AUTHORING_TOOLS;
  if (enabled) for (const [name, handle] of registeredTools) if (!enabled.has(name)) handle.disable();
}

function readResponseMode(): ResponseMode {
  const value = process.env.PROSPERO_RESPONSE_MODE;
  return value === "summary" || value === "full" ? value : "standard";
}

function compactForResponse(value: unknown, mode: ResponseMode, key = "", depth = 0): unknown {
  if (mode === "full") return value;
  const omitted = mode === "summary" ? SUMMARY_OMIT_KEYS : STANDARD_OMIT_KEYS;
  if (omitted.has(key.toLowerCase())) return `[omitted in ${mode} mode]`;
  if (typeof value === "string") {
    const limit = mode === "summary" ? 800 : 20_000;
    return value.length > limit ? `${value.slice(0, limit)}\n[truncated ${value.length - limit} characters]` : value;
  }
  if (Array.isArray(value)) {
    const limit = mode === "summary" ? 5 : 100;
    const items = value.slice(0, limit).map((item) => compactForResponse(item, mode, key, depth + 1));
    return value.length > limit ? { count: value.length, items, truncated: true } : items;
  }
  if (value && typeof value === "object") {
    if (depth > (mode === "summary" ? 6 : 12)) return "[depth limited]";
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [childKey, compactForResponse(child, mode, childKey, depth + 1)]));
  }
  return value;
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function definedConceptOverrides(
  value: Record<string, string | string[] | undefined> | undefined,
): Partial<ProtocolSearchConcepts> | undefined {
  if (!value) return undefined;
  return Object.fromEntries(Object.entries(value).filter((entry) => entry[1] !== undefined)) as Partial<ProtocolSearchConcepts>;
}

const CORE_TOOLS = new Set([
  "prospero_health", "prospero_search_protocols", "prospero_get_protocol", "prospero_record_workflow",
  "prospero_build_query", "prospero_protocol_to_registration", "prospero_analyze_protocol",
]);
const AUTHORING_TOOLS = new Set([
  ...CORE_TOOLS,
  "prospero_bulk_export", "prospero_compare_similar_reviews", "prospero_generate_workbook", "prospero_validate_registration",
  "prospero_validate_search_strategy", "prospero_compare_protocol_versions", "prospero_generate_local_preview",
  "prospero_monitor_similar_reviews", "prospero_list_drafts", "prospero_get_registration_schema", "prospero_similar_reviews",
]);
const STANDARD_OMIT_KEYS = new Set(["raw", "html"]);
const SUMMARY_OMIT_KEYS = new Set(["raw", "html", "workbook", "content", "candidate_fields", "abstract", "summary", "quote"]);

applyToolProfile();
main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`[prospero-mcp] fatal: ${message}\n`);
  process.exit(1);
});
