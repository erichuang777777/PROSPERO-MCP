#!/usr/bin/env node
import "dotenv/config";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { resolveConfig } from "./config.js";
import { loadProsperoSessionState, resolveBrowserPath } from "./prospero-browser.js";
import { ProsperoClient } from "./prospero-client.js";
import {
  fetchProsperoRecordPage,
  fetchProsperoRegisterChecklist,
  openProsperoMyProspero,
  startProsperoRegistration,
} from "./prospero-page.js";
import type {
  ProsperoSearchArgs,
  ProsperoRecordWorkflowMode,
  ProsperoSimilarReviewInput,
} from "./types.js";

const config = resolveConfig();
const client = new ProsperoClient(config);

const server = new McpServer({
  name: "prospero-mcp",
  version: "0.1.0",
});

server.registerTool(
  "prospero_health",
  {
    title: "PROSPERO Health",
    description: "Return the configured PROSPERO API base URL and runtime settings.",
  },
  async () => {
    const browserAvailable = await resolveBrowserPath().then(() => true).catch(() => false);
    const sessionCaptured = loadProsperoSessionState() !== null;
    return ok({
      healthy: true,
      base_url: config.baseUrl,
      timeout_ms: config.timeoutMs,
      browser_available: browserAvailable,
      login_session_captured: sessionCaptured,
      setup_complete: browserAvailable && sessionCaptured,
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
    }),
  },
  async (args) => runSearch(args),
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
    const result = await client.checkSimilarReviews(args as ProsperoSimilarReviewInput);
    return ok({
      count: result.length,
      results: result,
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
    const result = await client.searchByAccession(args.accession_number);
    const exact = result.hits.find(
      (hit) => hit.accession_number.toUpperCase() === args.accession_number.trim().toUpperCase(),
    );
    return ok({
      accession_number: args.accession_number,
      found: exact != null,
      protocol: exact ?? result.hits[0] ?? null,
      search: result,
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
    if (args.mode === "view_record") {
      const record = await fetchProsperoRecordPage(args.accession_number);
      return ok({
        mode: args.mode,
        record,
      });
    }

    if (args.mode === "myprospero") {
      const snapshot = await openProsperoMyProspero();
      return ok({
        mode: args.mode,
        page: snapshot,
      });
    }

    if (args.mode === "register_checklist") {
      const checklist = await fetchProsperoRegisterChecklist();
      return ok({
        mode: args.mode,
        checklist,
      });
    }

    const registration = await startProsperoRegistration();
    return ok({
      mode: args.mode,
      registration,
    });
  },
);

async function runSearch(args: ProsperoSearchArgs) {
  const result = await client.search(args);
  return ok(result);
}

function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: isObject(data) ? data : { value: data },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`[prospero-mcp] fatal: ${message}\n`);
  process.exit(1);
});
