import * as cheerio from "cheerio";
import type { Element } from "domhandler";

import { ProsperoError } from "./errors.js";
import { withRetry } from "./retry.js";
import { assertExternalNetworkAllowed, assertSafeOutboundText } from "./safety-policy.js";
import { cacheKey, readPublicCache, writePublicCache } from "./public-cache.js";

export interface PubMedRecord {
  pmid: string;
  title: string;
  abstract: string;
  publication_date: string | null;
  publication_types: string[];
  authors: string[];
  journal: string | null;
  doi: string | null;
  url: string;
}

export interface PubMedSearchResult {
  query: string;
  total_hits: number;
  records: PubMedRecord[];
  cache_status?: string;
}

export interface PubMedClientOptions {
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  tool?: string | undefined;
  email?: string | undefined;
  timeoutMs?: number | undefined;
  minimumIntervalMs?: number | undefined;
  fetchImpl?: typeof fetch | undefined;
}

export class PubMedClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly tool: string;
  private readonly email: string;
  private readonly timeoutMs: number;
  private readonly minimumIntervalMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly cacheEnabled: boolean;
  private lastRequestAt = 0;

  constructor(options: PubMedClientOptions = {}) {
    this.baseUrl = ensureTrailingSlash(options.baseUrl ?? process.env.NCBI_EUTILS_BASE_URL ?? "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/");
    this.apiKey = options.apiKey ?? process.env.NCBI_API_KEY ?? "";
    this.tool = options.tool ?? process.env.NCBI_TOOL ?? "prospero-mcp";
    this.email = options.email ?? process.env.NCBI_EMAIL ?? "";
    this.timeoutMs = options.timeoutMs ?? readPositiveInteger(process.env.PUBMED_TIMEOUT_MS, 15_000);
    this.minimumIntervalMs = options.minimumIntervalMs ?? (this.apiKey ? 110 : 350);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.cacheEnabled = options.fetchImpl === undefined;
  }

  async searchReviews(query: string, maxRecords = 25): Promise<PubMedSearchResult> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return { query: normalizedQuery, total_hits: 0, records: [] };
    }
    assertSafeOutboundText(normalizedQuery, "pubmed");
    const bounded = Math.min(100, Math.max(1, Math.trunc(maxRecords)));
    const key = cacheKey({ query: normalizedQuery, maxRecords: bounded });
    const offline = process.env.PROSPERO_NETWORK_MODE !== "online";
    const cached = this.cacheEnabled ? readPublicCache<PubMedSearchResult>("pubmed-reviews", key, offline) : undefined;
    if (cached) return { ...cached.data, cache_status: `${cached.stale ? "stale offline" : "fresh"}; created ${cached.created_at}` };
    assertExternalNetworkAllowed("pubmed");
    const searchUrl = this.url("esearch.fcgi", {
      db: "pubmed",
      term: normalizedQuery,
      retmode: "json",
      retmax: String(bounded),
      sort: "relevance",
    });
    const searchJson = await this.getJson(searchUrl);
    const result = asRecord(searchJson.esearchresult);
    const ids = Array.isArray(result.idlist) ? result.idlist.filter((id): id is string => typeof id === "string" && /^\d+$/.test(id)) : [];
    const totalHits = Number.parseInt(typeof result.count === "string" ? result.count : "0", 10) || 0;
    if (!ids.length) {
      const empty = { query: normalizedQuery, total_hits: totalHits, records: [] };
      if (this.cacheEnabled) writePublicCache("pubmed-reviews", key, empty);
      return empty;
    }

    const fetchUrl = this.url("efetch.fcgi", {
      db: "pubmed",
      id: ids.join(","),
      retmode: "xml",
      rettype: "abstract",
    });
    const xml = await this.getText(fetchUrl);
    const output: PubMedSearchResult = {
      query: normalizedQuery,
      total_hits: totalHits,
      records: parsePubMedXml(xml),
    };
    if (this.cacheEnabled) writePublicCache("pubmed-reviews", key, output);
    return output;
  }

  private url(endpoint: string, parameters: Record<string, string>): string {
    const url = new URL(endpoint, this.baseUrl);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    if (this.apiKey) url.searchParams.set("api_key", this.apiKey);
    if (this.tool) url.searchParams.set("tool", this.tool);
    if (this.email) url.searchParams.set("email", this.email);
    return url.toString();
  }

  private async getJson(url: string): Promise<Record<string, unknown>> {
    const text = await this.request(url);
    try {
      return asRecord(JSON.parse(text));
    } catch (error) {
      throw new ProsperoError({
        code: "INVALID_RESPONSE",
        message: "PubMed returned a response that was not valid JSON.",
        retryable: true,
        action: "Continue with PROSPERO-only results or retry PubMed later.",
      }, { cause: error });
    }
  }

  private async getText(url: string): Promise<string> {
    return this.request(url);
  }

  private async request(url: string): Promise<string> {
    return withRetry(async () => {
      await this.waitForRateLimit();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        this.lastRequestAt = Date.now();
        const response = await this.fetchImpl(url, {
          headers: { "User-Agent": `${this.tool}/0.2 (NCBI E-utilities client)` },
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new ProsperoError({
            code: response.status === 429 || response.status >= 500 ? "SITE_UNAVAILABLE" : "HTTP_ERROR",
            message: `PubMed E-utilities returned HTTP ${response.status}.`,
            retryable: response.status === 429 || response.status >= 500,
            action: "Continue with PROSPERO-only results or retry PubMed later.",
            details: { status: response.status, source: "pubmed" },
          });
        }
        return await response.text();
      } catch (error) {
        if (error instanceof ProsperoError) throw error;
        const timedOut = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
        throw new ProsperoError({
          code: timedOut ? "NETWORK_TIMEOUT" : "NETWORK_ERROR",
          message: timedOut ? "PubMed did not respond before the configured timeout." : "The PubMed network request failed.",
          retryable: true,
          action: "Continue with PROSPERO-only results or retry PubMed later.",
          details: { source: "pubmed" },
        }, { cause: error });
      } finally {
        clearTimeout(timer);
      }
    }, { attempts: 2, delays_ms: [350] });
  }

  private async waitForRateLimit(): Promise<void> {
    const remaining = this.minimumIntervalMs - (Date.now() - this.lastRequestAt);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

export function parsePubMedXml(xml: string): PubMedRecord[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  return $("PubmedArticle").map((_index, element) => {
    const article = $(element);
    const pmid = article.find("MedlineCitation > PMID").first().text().trim();
    const abstract = article.find("Abstract > AbstractText").map((_abstractIndex, abstractElement) => {
      const item = $(abstractElement);
      const label = item.attr("Label")?.trim();
      const text = item.text().replace(/\s+/g, " ").trim();
      return label && text ? `${label}: ${text}` : text;
    }).get().filter(Boolean).join("\n");
    const authors = article.find("AuthorList > Author").map((_authorIndex, authorElement) => {
      const author = $(authorElement);
      const collective = author.find("CollectiveName").first().text().trim();
      if (collective) return collective;
      return [author.find("ForeName").first().text().trim(), author.find("LastName").first().text().trim()].filter(Boolean).join(" ");
    }).get().filter(Boolean);
    const publicationDate = readPublicationDate(article, $);
    const doi = article.find('PubmedData > ArticleIdList > ArticleId[IdType="doi"]').first().text().trim() || null;
    return {
      pmid,
      title: article.find("Article > ArticleTitle").first().text().replace(/\s+/g, " ").trim(),
      abstract,
      publication_date: publicationDate,
      publication_types: article.find("PublicationTypeList > PublicationType").map((_typeIndex, typeElement) => $(typeElement).text().trim()).get().filter(Boolean),
      authors,
      journal: article.find("Article > Journal > Title").first().text().trim() || null,
      doi,
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    };
  }).get().filter((record) => Boolean(record.pmid && record.title));
}

function readPublicationDate(article: cheerio.Cheerio<Element>, $: cheerio.CheerioAPI): string | null {
  const pubDate = article.find("JournalIssue > PubDate").first();
  const medlineDate = pubDate.find("MedlineDate").text().trim();
  if (medlineDate) return medlineDate;
  const parts = ["Year", "Month", "Day"].map((tag) => pubDate.find(tag).text().trim()).filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
