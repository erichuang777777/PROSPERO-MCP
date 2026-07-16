import { normalizeProsperoError } from "./errors.js";
import { createHash } from "node:crypto";
import type { LoadedProtocol } from "./protocol.js";
import type { ProsperoClient } from "./prospero-client.js";
import { PubMedClient, type PubMedRecord } from "./pubmed-client.js";
import { buildProsperoPicoQuery, bulkSearch, rankSearchHits, type ProsperoPicoQueryInput } from "./search-automation.js";
import type { ProsperoHit } from "./types.js";

export type LiteratureSourceStatus = "available" | "empty" | "unavailable" | "skipped";

export interface ProtocolSearchConcepts extends ProsperoPicoQueryInput {
  title: string;
}

export interface LiteratureSourceResult<T> {
  status: LiteratureSourceStatus;
  query: string | null;
  attempted_queries: string[];
  total_hits: number | null;
  records: T[];
  error: ReturnType<ReturnType<typeof normalizeProsperoError>["toJSON"]> | null;
}

export interface UnifiedSimilarReview {
  normalized_title: string;
  title: string;
  sources: Array<{
    source: "prospero" | "pubmed";
    identifier: string;
    url: string;
  }>;
  publication_date: string | number | null;
  status: string | null;
  summary: string;
  lexical_overlap: number;
  matched_terms: string[];
  missing_terms: string[];
  difference_rationale_draft: string;
}

export interface ProtocolPipelineOptions {
  includePubMed?: boolean | undefined;
  maxProspero?: number | undefined;
  maxPubMed?: number | undefined;
  conceptOverrides?: Partial<ProtocolSearchConcepts> | undefined;
  requireExternalConfirmation?: boolean | undefined;
  externalConfirmationHash?: string | undefined;
}

export interface ProtocolPipelineResult {
  concepts: ProtocolSearchConcepts;
  sources: {
    prospero: LiteratureSourceResult<ProsperoHit>;
    pubmed: LiteratureSourceResult<PubMedRecord>;
  };
  combined_reviews: UnifiedSimilarReview[];
  degraded: boolean;
  notes: string[];
  external_query_plan: { prospero: string[]; pubmed: string[]; confirmation_hash: string; confirmed: boolean };
}

export async function discoverProtocolSimilarReviews(
  protocol: LoadedProtocol,
  answers: Record<string, string>,
  prosperoClient: Pick<ProsperoClient, "search">,
  pubmedClient: Pick<PubMedClient, "searchReviews">,
  options: ProtocolPipelineOptions = {},
): Promise<ProtocolPipelineResult> {
  const concepts = deriveProtocolSearchConcepts(protocol, answers, options.conceptOverrides);
  const prosperoQueries = buildProsperoQueryLadder(concepts);
  const pubmedQueries = buildPubMedReviewQueries(concepts);
  const confirmationHash = createHash("sha256").update(JSON.stringify({ prospero: prosperoQueries, pubmed: options.includePubMed === false ? [] : pubmedQueries })).digest("hex");
  const confirmed = !options.requireExternalConfirmation || options.externalConfirmationHash === confirmationHash;
  if (!confirmed) {
    return {
      concepts,
      sources: { prospero: skippedSource(prosperoQueries[0] ?? null), pubmed: skippedSource(pubmedQueries[0] ?? null) },
      combined_reviews: [],
      degraded: false,
      notes: ["External queries were not sent. Review the query plan and return its confirmation_hash to authorize public-database searching."],
      external_query_plan: { prospero: prosperoQueries, pubmed: options.includePubMed === false ? [] : pubmedQueries, confirmation_hash: confirmationHash, confirmed: false },
    };
  }

  const [prospero, pubmed] = await Promise.all([
    runProsperoSource(prosperoClient, prosperoQueries, concepts, options.maxProspero ?? 25),
    options.includePubMed === false
      ? Promise.resolve(skippedSource<PubMedRecord>(pubmedQueries[0] ?? null))
      : runPubMedSource(pubmedClient, pubmedQueries, concepts, options.maxPubMed ?? 25),
  ]);
  const combined = mergeAndRankReviews(concepts, prospero.records, pubmed.records);
  const degraded = Boolean(prospero.error || pubmed.error);
  const notes = [
    "Similarity ranking is lexical triage, not a final academic similarity decision.",
    "Review full eligibility criteria and methods before using a difference rationale in PROSPERO.",
  ];
  if (pubmed.status === "unavailable") notes.push("PubMed was unavailable; the workbook and PROSPERO results remain usable.");
  if (pubmed.status === "skipped") notes.push("PubMed was disabled for this run; PROSPERO-only discovery was used.");
  if (prospero.status === "unavailable") notes.push("PROSPERO search was unavailable; the workbook and PubMed results remain usable.");
  return { concepts, sources: { prospero, pubmed }, combined_reviews: combined, degraded, notes, external_query_plan: { prospero: prosperoQueries, pubmed: options.includePubMed === false ? [] : pubmedQueries, confirmation_hash: confirmationHash, confirmed: true } };
}

export function deriveProtocolSearchConcepts(
  protocol: LoadedProtocol,
  answers: Record<string, string>,
  overrides: Partial<ProtocolSearchConcepts> = {},
): ProtocolSearchConcepts {
  const title = overrides.title?.trim() || firstUsefulLine(answers.review_title) || firstUsefulLine(protocol.text) || "systematic review";
  return {
    title,
    population: preferTerms(overrides.population, answers.population),
    condition: preferTerms(overrides.condition, answers.condition),
    intervention: preferTerms(overrides.intervention, answers.interventions_exposures),
    comparator: preferTerms(overrides.comparator, answers.comparators),
    outcomes: preferTerms(overrides.outcomes, answers.main_outcomes),
    additional: preferTerms(overrides.additional, answers.keywords),
    fielded: false,
  };
}

export function buildPubMedReviewQuery(concepts: ProtocolSearchConcepts): string {
  return buildPubMedReviewQueries(concepts)[0] ?? "(systematic[sb] OR meta-analysis[pt] OR systematic review[pt] OR review protocol[ti])";
}

export function buildPubMedReviewQueries(concepts: ProtocolSearchConcepts): string[] {
  const reviewFilter = "(systematic[sb] OR meta-analysis[pt] OR systematic review[pt] OR review protocol[ti])";
  const ladders = conceptLadders(concepts);
  const queries = ladders.map((groups) => {
    const topicGroups: string[] = [];
    for (const group of groups) addPubMedGroup(topicGroups, group);
    return [...topicGroups, reviewFilter].join(" AND ");
  });
  if (!queries.length) {
    const fallback = titleKeywords(concepts.title);
    if (fallback.length) queries.push(`(${fallback.map((term) => `${quotePhrase(term)}[Title/Abstract]`).join(" AND ")}) AND ${reviewFilter}`);
  }
  return unique(queries.filter(Boolean));
}

export function buildProsperoQueryLadder(concepts: ProtocolSearchConcepts): string[] {
  const queries = conceptLadders(concepts).map((groups) => {
    const [first = [], second = []] = groups;
    return buildProsperoPicoQuery({ condition: first, intervention: second });
  });
  const title = quotePhrase(concepts.title);
  if (title) queries.splice(1, 0, title);
  if (!queries.length && concepts.additional?.length) queries.push(buildProsperoPicoQuery({ additional: concepts.additional }));
  return unique(queries.filter(Boolean));
}

function conceptLadders(concepts: ProtocolSearchConcepts): string[][][] {
  const condition = concepts.condition ?? [];
  const intervention = concepts.intervention ?? [];
  const population = concepts.population ?? [];
  const ladders: string[][][] = [];
  if (condition.length && intervention.length) ladders.push([condition, intervention]);
  if (condition.length && population.length) ladders.push([condition, population]);
  if (condition.length) ladders.push([condition]);
  else if (intervention.length) ladders.push([intervention]);
  return ladders;
}

async function runProsperoSource(
  client: Pick<ProsperoClient, "search">,
  queries: string[],
  concepts: ProtocolSearchConcepts,
  maxRecords: number,
): Promise<LiteratureSourceResult<ProsperoHit>> {
  if (!queries.length) return skippedSource(null);
  const attempted: string[] = [];
  const records = new Map<string, ProsperoHit>();
  let totalHits = 0;
  let sourceError: LiteratureSourceResult<ProsperoHit>["error"] = null;
  for (const query of queries) {
    attempted.push(query);
    try {
      const result = await bulkSearch(client as ProsperoClient, { query, sort: "title", sort_order: "asc" }, Math.min(100, maxRecords));
      totalHits = Math.max(totalHits, result.pages[0]?.total_hits ?? 0);
      for (const hit of result.hits) records.set(hit.accession_number || hit.record_id, hit);
      if (records.size >= maxRecords) break;
    } catch (error) {
      sourceError = normalizeProsperoError(error).toJSON();
      break;
    }
  }
  const ranked = rankSearchHits([...records.values()], normalizedConceptTerms(concepts)).slice(0, maxRecords);
  if (!ranked.length && sourceError) return {
    status: "unavailable",
    query: attempted[0] ?? queries[0]!,
    attempted_queries: attempted,
    total_hits: null,
    records: [],
    error: sourceError,
  };
  return {
    status: ranked.length ? "available" : "empty",
    query: attempted[0] ?? null,
    attempted_queries: attempted,
    total_hits: totalHits,
    records: ranked,
    error: sourceError,
  };
}

async function runPubMedSource(
  client: Pick<PubMedClient, "searchReviews">,
  queries: string[],
  concepts: ProtocolSearchConcepts,
  maxRecords: number,
): Promise<LiteratureSourceResult<PubMedRecord>> {
  if (!queries.length) return skippedSource(null);
  const attempted: string[] = [];
  const records = new Map<string, PubMedRecord>();
  let totalHits = 0;
  let sourceError: LiteratureSourceResult<PubMedRecord>["error"] = null;
  for (const query of queries) {
    attempted.push(query);
    try {
      const result = await client.searchReviews(query, Math.min(100, maxRecords));
      totalHits = Math.max(totalHits, result.total_hits);
      for (const record of result.records) records.set(record.pmid, record);
      if (records.size >= maxRecords) break;
    } catch (error) {
      sourceError = normalizeProsperoError(error).toJSON();
      break;
    }
  }
  const ranked = rankPubMedRecords([...records.values()], normalizedConceptTerms(concepts)).slice(0, maxRecords);
  if (!ranked.length && sourceError) return {
    status: "unavailable",
    query: attempted[0] ?? queries[0]!,
    attempted_queries: attempted,
    total_hits: null,
    records: [],
    error: sourceError,
  };
  return {
    status: ranked.length ? "available" : "empty",
    query: attempted[0] ?? null,
    attempted_queries: attempted,
    total_hits: totalHits,
    records: ranked,
    error: sourceError,
  };
}

function mergeAndRankReviews(
  concepts: ProtocolSearchConcepts,
  prospero: ProsperoHit[],
  pubmed: PubMedRecord[],
): UnifiedSimilarReview[] {
  const terms = normalizedConceptTerms(concepts);
  const merged = new Map<string, UnifiedSimilarReview>();
  for (const hit of prospero) {
    addUnified(merged, terms, {
      title: hit.title,
      source: "prospero",
      identifier: hit.accession_number,
      url: `https://www.crd.york.ac.uk/PROSPERO/view/${hit.accession_number}`,
      publicationDate: hit.year_first_published,
      status: hit.review_status,
      summary: "",
    });
  }
  for (const record of pubmed) {
    addUnified(merged, terms, {
      title: record.title,
      source: "pubmed",
      identifier: record.pmid,
      url: record.url,
      publicationDate: record.publication_date,
      status: record.publication_types.join("; ") || null,
      summary: record.abstract,
    });
  }
  return [...merged.values()].sort((left, right) => right.lexical_overlap - left.lexical_overlap);
}

function addUnified(
  target: Map<string, UnifiedSimilarReview>,
  terms: string[],
  item: {
    title: string;
    source: "prospero" | "pubmed";
    identifier: string;
    url: string;
    publicationDate: string | number | null;
    status: string | null;
    summary: string;
  },
): void {
  const normalizedTitle = normalizeTitle(item.title);
  const existing = target.get(normalizedTitle);
  if (existing) {
    existing.sources.push({ source: item.source, identifier: item.identifier, url: item.url });
    if (!existing.summary && item.summary) existing.summary = item.summary;
    return;
  }
  const targetTokens = new Set(tokenize(`${item.title} ${item.summary}`));
  const matched = terms.filter((term) => targetTokens.has(term));
  const missing = terms.filter((term) => !targetTokens.has(term));
  const overlap = terms.length ? matched.length / terms.length : 0;
  const rationale = missing.length
    ? `Potential scope differences include ${missing.slice(0, 6).join(", ")}, which were not found in the indexed title or abstract. Verify against the full record before proceeding.`
    : "High lexical overlap was detected. Compare eligibility criteria, search dates, outcomes and synthesis methods before deciding whether the review should proceed.";
  target.set(normalizedTitle, {
    normalized_title: normalizedTitle,
    title: item.title,
    sources: [{ source: item.source, identifier: item.identifier, url: item.url }],
    publication_date: item.publicationDate,
    status: item.status,
    summary: item.summary,
    lexical_overlap: Number(overlap.toFixed(3)),
    matched_terms: matched,
    missing_terms: missing,
    difference_rationale_draft: rationale,
  });
}

function preferTerms(override: string[] | undefined, candidate: string | undefined): string[] {
  if (override) return unique(override.map(cleanTerm).filter(Boolean));
  if (!candidate) return [];
  return unique(candidate.split(/[;\n•]+|\s+-\s+/).map(cleanTerm).filter((term) => {
    const words = term.split(/\s+/).length;
    return words >= 1 && words <= 10 && term.length <= 100;
  })).slice(0, 6);
}

function cleanTerm(value: string): string {
  return value.replace(/^[-*\d.)\s]+/, "").replace(/^(included?|excluded?|population|intervention|outcomes?)\s*:\s*/i, "").replace(/[.!]+$/, "").trim();
}

function addPubMedGroup(target: string[], values: string[]): void {
  const cleaned = unique(values.map(cleanTerm).filter(Boolean)).slice(0, 6);
  if (cleaned.length) target.push(`(${cleaned.map((term) => `${quotePhrase(term)}[Title/Abstract]`).join(" OR ")})`);
}

function normalizedConceptTerms(concepts: ProtocolSearchConcepts): string[] {
  return unique([
    concepts.title,
    ...(concepts.population ?? []),
    ...(concepts.condition ?? []),
    ...(concepts.intervention ?? []),
    ...(concepts.comparator ?? []),
    ...(concepts.outcomes ?? []),
    ...(concepts.additional ?? []),
  ].flatMap(tokenize).filter((term) => term.length > 2 && !STOPWORDS.has(term)));
}

function titleKeywords(title: string): string[] {
  return unique(tokenize(title).filter((term) => term.length > 2 && !STOPWORDS.has(term))).slice(0, 6);
}

function firstUsefulLine(value: string | undefined): string {
  return value?.split(/\r?\n/).map((line) => line.replace(/^#+\s*/, "").trim()).find(Boolean)?.slice(0, 500) ?? "";
}

function quotePhrase(value: string): string {
  const escaped = value.trim().replace(/"/g, "\\\"");
  return /\s/.test(escaped) ? `"${escaped}"` : escaped;
}

function tokenize(value: string): string[] {
  return value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function normalizeTitle(value: string): string {
  return tokenize(value).join(" ");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function skippedSource<T>(query: string | null): LiteratureSourceResult<T> {
  return { status: "skipped", query, attempted_queries: [], total_hits: null, records: [], error: null };
}

function rankPubMedRecords(records: PubMedRecord[], terms: string[]): PubMedRecord[] {
  return [...records].sort((left, right) => indexedScore(right.title, right.abstract, terms) - indexedScore(left.title, left.abstract, terms));
}

function indexedScore(title: string, summary: string, terms: string[]): number {
  const titleTokens = new Set(tokenize(title));
  const summaryTokens = new Set(tokenize(summary));
  return terms.reduce((score, term) => score + (titleTokens.has(term) ? 3 : summaryTokens.has(term) ? 1 : 0), 0);
}

const STOPWORDS = new Set([
  "and", "for", "the", "with", "from", "into", "review", "systematic", "meta", "analysis", "protocol",
  "effects", "effect", "association", "among", "using", "based", "study", "studies", "this", "that", "will",
]);
