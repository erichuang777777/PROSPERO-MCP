import assert from "node:assert/strict";
import test from "node:test";

import { ProsperoError } from "../src/errors.js";
import {
  buildPubMedReviewQuery,
  discoverProtocolSimilarReviews,
} from "../src/protocol-pipeline.js";
import type { LoadedProtocol } from "../src/protocol.js";
import type { ProsperoSearchPage } from "../src/types.js";

const protocol: LoadedProtocol = {
  source: "text",
  path: null,
  format: "markdown",
  text: "# Title\nBreast cancer prediction tests\n# Condition\nBreast cancer",
  characters: 75,
  warnings: [],
};

const answers = {
  review_title: "Breast cancer prediction tests: a systematic review",
  condition: "Breast cancer",
  population: "Women without a breast cancer diagnosis",
  interventions_exposures: "Prediction tests",
};

test("PubMed review query is topic focused and review restricted", () => {
  const query = buildPubMedReviewQuery({
    title: answers.review_title,
    condition: ["breast cancer"],
    intervention: ["prediction tests"],
  });
  assert.match(query, /"breast cancer"\[Title\/Abstract\]/);
  assert.match(query, /systematic\[sb\]/);
});

test("pipeline keeps PROSPERO results when PubMed is unavailable", async () => {
  const result = await discoverProtocolSimilarReviews(
    protocol,
    answers,
    { search: async (args): Promise<ProsperoSearchPage> => ({
      page: args.page ?? 1,
      page_size: args.page_size ?? 25,
      query: args.query,
      total_hits: 1,
      hits: [{
        record_id: "1",
        accession_number: "CRD420251181863",
        title: "Breast Cancer Prediction Tests",
        review_status: "Ongoing",
        editing_status: "live",
        living_status: null,
        year_first_published: 2025,
        raw: {},
      }],
      aggregations: {},
      raw_note: undefined,
    }) },
    { searchReviews: async () => { throw new ProsperoError({
      code: "SITE_UNAVAILABLE",
      message: "PubMed unavailable",
      retryable: true,
      action: "Retry later",
    }); } },
  );
  assert.equal(result.sources.prospero.status, "available");
  assert.equal(result.sources.pubmed.status, "unavailable");
  assert.equal(result.combined_reviews.length, 1);
  assert.equal(result.degraded, true);
});

test("pipeline can explicitly run without PubMed", async () => {
  let pubmedCalls = 0;
  const result = await discoverProtocolSimilarReviews(
    protocol,
    answers,
    { search: async (args): Promise<ProsperoSearchPage> => ({
      page: 1, page_size: 25, query: args.query, total_hits: 0, hits: [], aggregations: {}, raw_note: undefined,
    }) },
    { searchReviews: async () => { pubmedCalls += 1; return { query: "", total_hits: 0, records: [] }; } },
    { includePubMed: false },
  );
  assert.equal(result.sources.prospero.status, "empty");
  assert.equal(result.sources.pubmed.status, "skipped");
  assert.equal(pubmedCalls, 0);
  assert.equal(result.degraded, false);
});

test("query ladder broadens after an exact search returns no records", async () => {
  let prosperoCalls = 0;
  const result = await discoverProtocolSimilarReviews(
    protocol,
    answers,
    { search: async (args): Promise<ProsperoSearchPage> => {
      prosperoCalls += 1;
      const found = prosperoCalls === 2;
      return {
        page: 1,
        page_size: 1,
        query: args.query,
        total_hits: found ? 1 : 0,
        hits: found ? [{
          record_id: "2",
          accession_number: "CRD420251181863",
          title: "Breast Cancer Prediction Tests",
          review_status: "Ongoing",
          editing_status: "live",
          living_status: null,
          year_first_published: 2025,
          raw: {},
        }] : [],
        aggregations: {},
        raw_note: undefined,
      };
    } },
    { searchReviews: async () => ({ query: "", total_hits: 0, records: [] }) },
    { includePubMed: false, maxProspero: 1 },
  );
  assert.equal(prosperoCalls, 2);
  assert.equal(result.sources.prospero.status, "available");
  assert.equal(result.sources.prospero.attempted_queries.length, 2);
});

test("a later PubMed failure preserves earlier PubMed records", async () => {
  let pubmedCalls = 0;
  const result = await discoverProtocolSimilarReviews(
    protocol,
    answers,
    { search: async (args): Promise<ProsperoSearchPage> => ({
      page: 1, page_size: 5, query: args.query, total_hits: 0, hits: [], aggregations: {}, raw_note: undefined,
    }) },
    { searchReviews: async (query) => {
      pubmedCalls += 1;
      if (pubmedCalls > 1) throw new ProsperoError({ code: "NETWORK_TIMEOUT", message: "timeout", retryable: true, action: "retry" });
      return {
        query,
        total_hits: 1,
        records: [{
          pmid: "12345678",
          title: "Breast cancer prediction tests: a systematic review",
          abstract: "Women's perceptions of prediction tests.",
          publication_date: "2025",
          publication_types: ["Systematic Review"],
          authors: ["Jane Doe"],
          journal: "Systematic Reviews",
          doi: null,
          url: "https://pubmed.ncbi.nlm.nih.gov/12345678/",
        }],
      };
    } },
    { maxPubMed: 5 },
  );
  assert.equal(result.sources.pubmed.status, "available");
  assert.equal(result.sources.pubmed.records.length, 1);
  assert.equal(result.sources.pubmed.error?.code, "NETWORK_TIMEOUT");
  assert.equal(result.degraded, true);
});

test("protocol-derived external queries require an exact preview hash when enabled", async () => {
  let calls = 0;
  const prospero = { search: async (): Promise<ProsperoSearchPage> => { calls += 1; throw new Error("must not run"); } };
  const pubmed = { searchReviews: async () => { calls += 1; throw new Error("must not run"); } };
  const preview = await discoverProtocolSimilarReviews(protocol, answers, prospero, pubmed, { requireExternalConfirmation: true });
  assert.equal(calls, 0);
  assert.equal(preview.external_query_plan.confirmed, false);
  assert.equal(preview.sources.prospero.status, "skipped");
  assert.match(preview.external_query_plan.confirmation_hash, /^[a-f0-9]{64}$/);
});
