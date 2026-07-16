import type {
  ProsperoConfig,
  ProsperoHit,
  ProsperoSearchArgs,
  ProsperoSearchFilter,
  ProsperoSearchPage,
  ProsperoSimilarReview,
  ProsperoSimilarReviewInput,
  ProsperoSortField,
} from "./types.js";
import { ProsperoError } from "./errors.js";
import { withRetry } from "./retry.js";
import { assertExternalNetworkAllowed, assertSafeOutboundText } from "./safety-policy.js";
import { cacheKey, readPublicCache, writePublicCache } from "./public-cache.js";

export class ProsperoClient {
  constructor(private readonly config: ProsperoConfig) {}

  async search(args: ProsperoSearchArgs): Promise<ProsperoSearchPage> {
    const page = args.page ?? 1;
    const pageSize = clampInt(args.page_size ?? 20, 1, 50);
    const query = args.query.trim();
    assertSafeOutboundText(query, "prospero");
    const field = args.field ?? "ALL";
    const effectiveQuery = field === "ALL" ? query : `(${query}):${field}`;
    const sort = mapSortField(args.sort ?? "title");
    const sortOrder = args.sort_order ?? "asc";
    const filters = buildFilters(args);
    const key = cacheKey({ effectiveQuery, page, pageSize, sort, sortOrder, filters });
    const offline = process.env.PROSPERO_NETWORK_MODE !== "online";
    const cached = readPublicCache<ProsperoSearchPage>("prospero-search", key, offline);
    if (cached) return { ...cached.data, raw_note: `cache: ${cached.stale ? "stale offline" : "fresh"}; created ${cached.created_at}` };
    assertExternalNetworkAllowed("prospero");

    const response = await this.postSearch({
      term: effectiveQuery,
      actual: effectiveQuery,
      line: page,
      page,
      nperpage: pageSize,
      sort,
      sortorder: sortOrder,
      filters,
      download: false,
    });

    const normalized = normalizeSearchPage(response, page, pageSize, effectiveQuery);
    writePublicCache("prospero-search", key, normalized);
    return normalized;
  }

  async searchByAccession(accession: string): Promise<ProsperoSearchPage> {
    return this.search({
      query: accession.trim(),
      field: "AN",
      page: 1,
      page_size: 10,
      sort: "accession",
      sort_order: "asc",
    });
  }

  async checkSimilarReviews(
    input: ProsperoSimilarReviewInput,
  ): Promise<ProsperoSimilarReview[]> {
    assertExternalNetworkAllowed("prospero");
    assertSafeOutboundText([
      input.title,
      input.review_question,
      input.condition,
      input.intervention,
      input.comparator,
      input.outcomes,
    ].filter(Boolean).join(" "), "prospero");
    const response = await this.postJson("record/checksimilarrecords", {
      recordversion: input.recordversion ?? 0,
      title: input.title,
      rq: input.review_question,
      condition: input.condition ?? "",
      intervention: input.intervention ?? "",
      comparator: input.comparator ?? "",
      outcomes: input.outcomes ?? "",
      threshold: input.threshold ?? 0.4,
    });
    return extractSimilarReviews(response).map(normalizeSimilarReview);
  }

  private async postSearch(payload: Record<string, unknown>): Promise<unknown> {
    return this.postJson("search", payload);
  }

  private async postJson(path: string, payload: Record<string, unknown>): Promise<unknown> {
    return withRetry(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

      try {
        let res: Response;
        try {
          res = await fetch(new URL(path, this.config.baseUrl), {
            method: "POST",
            headers: this.buildHeaders(),
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            throw new ProsperoError({
              code: "NETWORK_TIMEOUT",
              message: `PROSPERO API timed out after ${this.config.timeoutMs} ms.`,
              retryable: true,
              action: "Retry after PROSPERO recovers or increase PROSPERO_TIMEOUT_MS.",
              details: { path },
            }, { cause: error });
          }
          throw new ProsperoError({
            code: "NETWORK_ERROR",
            message: "The PROSPERO API request failed before a response was received.",
            retryable: true,
            action: "Check network access and retry after PROSPERO recovers.",
            details: { path },
          }, { cause: error });
        }

        const rawText = await res.text();
        if (res.status === 401 || res.status === 403) {
          throw new ProsperoError({
            code: "AUTH_REQUIRED",
            message: "PROSPERO rejected the authentication state.",
            retryable: false,
            action: "Run prospero-mcp-login and retry.",
            details: { path, status: res.status },
          });
        }
        if (res.status >= 500) {
          throw new ProsperoError({
            code: "SITE_UNAVAILABLE",
            message: `PROSPERO returned HTTP ${res.status}.`,
            retryable: true,
            action: "Retry after the PROSPERO service recovers.",
            details: { path, status: res.status },
          });
        }
        if (!res.ok) {
          throw new ProsperoError({
            code: "HTTP_ERROR",
            message: `PROSPERO returned HTTP ${res.status}.`,
            retryable: false,
            action: "Review the request and PROSPERO response status.",
            details: { path, status: res.status, response_preview: rawText.slice(0, 300) },
          });
        }

        try {
          return JSON.parse(rawText) as unknown;
        } catch (error) {
          throw new ProsperoError({
            code: "INVALID_RESPONSE",
            message: "PROSPERO returned non-JSON content for an API request.",
            retryable: false,
            action: "Check whether the PROSPERO API contract changed.",
            details: { path, response_preview: rawText.slice(0, 300) },
          }, { cause: error });
        }
      } finally {
        clearTimeout(timeout);
      }
    });
  }

  private buildHeaders(): Record<string, string> {
    return {
      "content-type": "application/json",
      "cache-control": "no-cache",
      pragma: "no-cache",
      expires: "0",
      "prospero-access-token": this.config.accessToken,
      "prospero-auth-token": this.config.authToken ?? makeAuthToken(),
    };
  }
}

export function buildFilters(args: ProsperoSearchArgs): ProsperoSearchFilter[] {
  const filters: ProsperoSearchFilter[] = [...(args.filters ?? [])];

  if (args.record_type?.length) {
    filters.push({ name: "recordtype", value: [...args.record_type] });
  }
  if (args.review_status?.length) {
    filters.push({ name: "reviewstatus", value: [...args.review_status] });
  }
  if (args.year_in_prospero?.length) {
    filters.push({ name: "yearfirstpublished", value: [...args.year_in_prospero] });
  }
  if (args.date_registered_start || args.date_registered_end) {
    const start = args.date_registered_start ?? args.date_registered_end ?? "";
    const end = args.date_registered_end ?? args.date_registered_start ?? "";
    filters.push({ name: "dateinprospero", value: [`${start} to ${end}`] });
  }

  return filters;
}

export function normalizeSearchPage(
  response: unknown,
  page: number,
  pageSize: number,
  query: string,
): ProsperoSearchPage {
  const pageEntry = Array.isArray(response) ? response[page - 1] : undefined;
  const hitsArray = extractHits(pageEntry);

  return {
    page,
    page_size: pageSize,
    query,
    total_hits: extractTotalHits(pageEntry),
    hits: hitsArray.map(normalizeHit),
    aggregations: extractAggregations(pageEntry),
    raw_note: extractNote(pageEntry),
  };
}

function extractHits(pageEntry: unknown): Record<string, unknown>[] {
  const hits = getObject(pageEntry)?.retvals?.hits?.hits;
  return Array.isArray(hits) ? (hits as Record<string, unknown>[]) : [];
}

function extractTotalHits(pageEntry: unknown): number {
  const total = getObject(pageEntry)?.retvals?.hits?.total?.value;
  return typeof total === "number" ? total : 0;
}

function extractAggregations(pageEntry: unknown): Record<string, unknown> {
  const aggs = getObject(pageEntry)?.retvals?.aggs;
  return isRecord(aggs) ? aggs : {};
}

function extractNote(pageEntry: unknown): string | undefined {
  const note = getObject(pageEntry)?.note;
  if (!isRecord(note)) return undefined;
  if (typeof note.errormessage?.errormessage === "string") {
    return note.errormessage.errormessage;
  }
  if (typeof note.status === "string" && note.status !== "ok") {
    return note.status;
  }
  return undefined;
}

function extractSimilarReviews(response: unknown): Record<string, unknown>[] {
  const results = getObject(response)?.results;
  return Array.isArray(results) ? (results as Record<string, unknown>[]) : [];
}

function normalizeSimilarReview(item: Record<string, unknown>): ProsperoSimilarReview {
  return {
    record_id: stringValue(item.RecordID),
    accession_number: stringValue(item.AccessionNumber),
    title: stripHtml(stringValue(item.Title)),
    review_question: stripHtml(stringValue(item.ReviewQ)),
    first_published: stringOrNull(item.DateFirstPublished),
    score: numberOrNull(item.percent),
    raw: item,
  };
}

function normalizeHit(hit: Record<string, unknown>): ProsperoHit {
  const source = isRecord(hit._source) ? hit._source : {};
  return {
    record_id: stringValue(hit._id),
    accession_number: stringValue(source.accessionnumber),
    title: stripHtml(stringValue(source.title)),
    review_status: stringOrNull(source.reviewstatus),
    editing_status: stringOrNull(source.editingstatus),
    living_status: stringOrNull(source.isliving),
    year_first_published: numberOrNull(source.yearfirstpublished),
    raw: {
      id: hit._id,
      score: hit._score,
      source,
    },
  };
}

function mapSortField(field: ProsperoSortField): string {
  if (field === "accession") return "an";
  if (field === "year") return "yr";
  return "ti";
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function makeAuthToken(): string {
  return Buffer.from(String(Date.now()), "utf8").toString("base64");
}

function getObject(value: unknown): Record<string, any> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stripHtml(raw: string): string {
  return raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
