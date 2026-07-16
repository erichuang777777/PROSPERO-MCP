import type { ProsperoHit, ProsperoSearchArgs, ProsperoSearchPage, ProsperoSimilarReview } from "./types.js";
import type { ProsperoClient } from "./prospero-client.js";

export interface ProsperoPicoQueryInput {
  population?: string[] | undefined;
  condition?: string[] | undefined;
  intervention?: string[] | undefined;
  comparator?: string[] | undefined;
  outcomes?: string[] | undefined;
  additional?: string[] | undefined;
  fielded?: boolean | undefined;
}

export interface SimilarReviewComparison {
  accession_number: string;
  title: string;
  prospero_score: number | null;
  lexical_overlap: number;
  matched_terms: string[];
  missing_terms: string[];
  difference_rationale_draft: string;
}

export function buildProsperoPicoQuery(input: ProsperoPicoQueryInput): string {
  const groups: string[] = [];
  addGroup(groups, [...(input.population ?? []), ...(input.condition ?? [])], input.fielded ? "PA" : undefined);
  addGroup(groups, input.intervention ?? [], input.fielded ? "IV" : undefined);
  addGroup(groups, input.comparator ?? [], input.fielded ? "CM" : undefined);
  addGroup(groups, input.outcomes ?? [], input.fielded ? "OP" : undefined);
  addGroup(groups, input.additional ?? [], undefined);
  return groups.join(" AND ");
}

export function rankSearchHits(hits: ProsperoHit[], concepts: string[]): ProsperoHit[] {
  const terms = normalizeTerms(concepts);
  return [...hits].sort((left, right) => scoreHit(right, terms) - scoreHit(left, terms));
}

export async function bulkSearch(
  client: ProsperoClient,
  args: ProsperoSearchArgs,
  maxRecords: number,
): Promise<{ pages: ProsperoSearchPage[]; hits: ProsperoHit[] }> {
  const bounded = Math.min(500, Math.max(1, Math.trunc(maxRecords)));
  const pageSize = Math.min(50, bounded);
  const first = await client.search({ ...args, page: 1, page_size: pageSize });
  const pages = [first];
  const totalPages = Math.min(Math.ceil(first.total_hits / pageSize), Math.ceil(bounded / pageSize));
  for (let page = 2; page <= totalPages; page += 1) {
    pages.push(await client.search({ ...args, page, page_size: pageSize }));
  }
  const unique = new Map<string, ProsperoHit>();
  for (const hit of pages.flatMap((page) => page.hits)) unique.set(hit.accession_number || hit.record_id, hit);
  return { pages, hits: [...unique.values()].slice(0, bounded) };
}

export function exportSearchHits(hits: ProsperoHit[], format: "json" | "csv" | "ris"): string {
  if (format === "json") return `${JSON.stringify(hits, null, 2)}\n`;
  if (format === "csv") {
    const rows = [
      ["accession_number", "title", "review_status", "year_first_published", "record_id"],
      ...hits.map((hit) => [
        hit.accession_number,
        hit.title,
        hit.review_status ?? "",
        hit.year_first_published?.toString() ?? "",
        hit.record_id,
      ]),
    ];
    return `${rows.map((row) => row.map(csvValue).join(",")).join("\n")}\n`;
  }
  return hits.map((hit) => [
    "TY  - RPRT",
    `TI  - ${hit.title}`,
    `AN  - ${hit.accession_number}`,
    ...(hit.year_first_published ? [`PY  - ${hit.year_first_published}`] : []),
    `UR  - https://www.crd.york.ac.uk/PROSPERO/view/${hit.accession_number}`,
    "ER  - ",
  ].join("\n")).join("\n\n") + (hits.length ? "\n" : "");
}

export function compareSimilarReviews(
  source: ProsperoPicoQueryInput & { title: string; review_question: string },
  reviews: ProsperoSimilarReview[],
): SimilarReviewComparison[] {
  const concepts = normalizeTerms([
    source.title,
    source.review_question,
    ...(source.population ?? []),
    ...(source.condition ?? []),
    ...(source.intervention ?? []),
    ...(source.comparator ?? []),
    ...(source.outcomes ?? []),
  ]);
  return reviews.map((review) => {
    const targetTerms = new Set(tokenize(`${review.title} ${review.review_question}`));
    const matched = concepts.filter((term) => targetTerms.has(term));
    const missing = concepts.filter((term) => !targetTerms.has(term));
    const overlap = concepts.length ? matched.length / concepts.length : 0;
    const rationale = missing.length
      ? `This review proceeds because its planned scope explicitly includes ${missing.slice(0, 6).join(", ")}, which is not evident in the title or review question of ${review.accession_number}. The review team should verify this distinction against the full record.`
      : `Substantial lexical overlap was detected with ${review.accession_number}. The review team should compare population, intervention/exposure, outcomes, dates and synthesis methods before deciding whether the new review should proceed.`;
    return {
      accession_number: review.accession_number,
      title: review.title,
      prospero_score: review.score,
      lexical_overlap: Number(overlap.toFixed(3)),
      matched_terms: matched,
      missing_terms: missing,
      difference_rationale_draft: rationale,
    };
  }).sort((left, right) => (right.prospero_score ?? right.lexical_overlap) - (left.prospero_score ?? left.lexical_overlap));
}

function addGroup(target: string[], values: string[], field: string | undefined) {
  const cleaned = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (!cleaned.length) return;
  const group = `(${cleaned.map(quoteTerm).join(" OR ")})`;
  target.push(field ? `${group}:${field}` : group);
}

function quoteTerm(term: string): string {
  const escaped = term.replace(/"/g, "\\\"");
  return /\s/.test(escaped) && !/[()*?]/.test(escaped) ? `"${escaped}"` : escaped;
}

function scoreHit(hit: ProsperoHit, terms: string[]): number {
  const title = hit.title.toLowerCase();
  return terms.reduce((score, term) => score + (title.includes(term) ? (title === term ? 5 : 2) : 0), 0);
}

function normalizeTerms(values: string[]): string[] {
  return [...new Set(values.flatMap(tokenize).filter((term) => term.length > 2))];
}

function tokenize(value: string): string[] {
  return value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function csvValue(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
