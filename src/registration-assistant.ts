import { createHash } from "node:crypto";

import type { LoadedProtocol } from "./protocol.js";
import { REGISTRATION_CATALOG } from "./registration-catalog.js";
import { REGISTRATION_CONSTRAINTS_BY_KEY } from "./registration-snapshot.js";

export type RegistrationFieldState = "missing" | "extracted" | "generated" | "needs_confirmation" | "confirmed" | "stale" | "blocked";

export interface FieldProvenance {
  source: "protocol" | "user" | "generated";
  file: string | null;
  section: string | null;
  page: number | null;
  line: number | null;
  quote: string | null;
  source_hash: string | null;
}

export interface RegistrationFieldAnalysis {
  key: string;
  title: string;
  state: RegistrationFieldState;
  answer: string;
  confidence: "low" | "medium" | "high";
  required: boolean;
  minimum_words: number | null;
  maximum_words: number | null;
  word_count: number;
  provenance: FieldProvenance;
  unsupported_terms: string[];
  question: string | null;
}

export interface RegistrationAnalysisManifest {
  version: 1;
  protocol_hash: string;
  generated_at: string;
  fields: RegistrationFieldAnalysis[];
  counts: Record<RegistrationFieldState, number>;
  blocking_fields: string[];
}

export function analyzeRegistrationFields(
  protocol: LoadedProtocol,
  extracted: Record<string, string>,
  answers: Record<string, string>,
  confirmedKeys: string[] = [],
  previous?: RegistrationAnalysisManifest | undefined,
): RegistrationAnalysisManifest {
  const confirmed = new Set(confirmedKeys);
  const prior = new Map(previous?.fields.map((field) => [field.key, field]) ?? []);
  const fields = REGISTRATION_CATALOG.map((catalog): RegistrationFieldAnalysis => {
    const answer = answers[catalog.key]?.trim() ?? "";
    const source = extracted[catalog.key]?.trim() ?? "";
    const constraint = REGISTRATION_CONSTRAINTS_BY_KEY.get(catalog.key)!;
    const provenance = locateProvenance(protocol, source);
    const unsupported = source && answer ? unsupportedTerms(answer, source) : answer && !source ? meaningfulTerms(answer).slice(0, 12) : [];
    let state: RegistrationFieldState;
    if (!answer) state = "missing";
    else if (confirmed.has(catalog.key)) state = "confirmed";
    else if (!source) state = catalog.automation === "manual" ? "needs_confirmation" : "generated";
    else if (catalog.automation === "manual" || catalog.automation === "organize_confirm" || unsupported.length) state = "needs_confirmation";
    else state = "extracted";
    const previousField = prior.get(catalog.key);
    if (previousField?.state === "confirmed" && previousField.provenance.source_hash !== provenance.source_hash) state = "stale";
    if (MANUAL_ONLY.has(catalog.key) && state === "generated") state = "blocked";
    return {
      key: catalog.key,
      title: catalog.title,
      state,
      answer,
      confidence: state === "confirmed" || state === "extracted" ? "high" : state === "needs_confirmation" || state === "stale" ? "medium" : "low",
      required: constraint.required,
      minimum_words: constraint.minimum_words,
      maximum_words: constraint.maximum_words,
      word_count: countWords(answer),
      provenance: answer && !source ? { ...provenance, source: confirmed.has(catalog.key) ? "user" : "generated" } : provenance,
      unsupported_terms: unsupported,
      question: questionFor(catalog.key, catalog.title, state),
    };
  });
  const counts = Object.fromEntries(FIELD_STATES.map((state) => [state, fields.filter((field) => field.state === state).length])) as Record<RegistrationFieldState, number>;
  return {
    version: 1,
    protocol_hash: hash(protocol.text),
    generated_at: new Date().toISOString(),
    fields,
    counts,
    blocking_fields: fields.filter((field) => field.required && ["missing", "blocked", "stale"].includes(field.state)).map((field) => field.key),
  };
}

export function buildMissingInformationInterview(manifest: RegistrationAnalysisManifest) {
  return manifest.fields.filter((field) => field.question).map((field) => ({
    key: field.key,
    title: field.title,
    state: field.state,
    required: field.required,
    current_answer: field.answer || null,
    source_quote: field.provenance.quote,
    question: field.question,
    accepted_answer_sources: ["review_team_decision", "protocol_amendment", "existing_protocol_text"],
    requires_human_declaration: MANUAL_ONLY.has(field.key),
  }));
}

function locateProvenance(protocol: LoadedProtocol, source: string): FieldProvenance {
  if (!source) return { source: "generated", file: protocol.path, section: null, page: null, line: null, quote: null, source_hash: null };
  const index = protocol.text.indexOf(source);
  const line = index >= 0 ? protocol.text.slice(0, index).split(/\r?\n/).length : null;
  const page = protocol.pages?.find((item) => normalize(item.text).includes(normalize(source).slice(0, 80)))?.page ?? null;
  const before = index >= 0 ? protocol.text.slice(0, index) : "";
  const section = [...before.matchAll(/^#{1,6}\s+(.+)$/gm)].at(-1)?.[1]?.trim() ?? null;
  return {
    source: "protocol",
    file: protocol.path,
    section,
    page,
    line,
    quote: source.slice(0, 800),
    source_hash: hash(source),
  };
}

function unsupportedTerms(answer: string, source: string): string[] {
  const sourceTerms = new Set(meaningfulTerms(source));
  return meaningfulTerms(answer).filter((term) => !sourceTerms.has(term)).slice(0, 20);
}

function meaningfulTerms(value: string): string[] {
  return [...new Set((value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((term) => term.length > 3 && !STOPWORDS.has(term)))];
}

function questionFor(key: string, title: string, state: RegistrationFieldState): string | null {
  if (["confirmed", "extracted"].includes(state)) return null;
  const specific = QUESTIONS[key];
  if (state === "stale") return `The protocol source for ${title} changed after confirmation. What is the current team-approved answer?`;
  if (state === "blocked") return specific ?? `Please provide the review team's own declaration for ${title}.`;
  return specific ?? `What should be entered for ${title}, and is the answer supported by protocol text or a team-approved amendment?`;
}

function countWords(value: string): number {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const FIELD_STATES: RegistrationFieldState[] = ["missing", "extracted", "generated", "needs_confirmation", "confirmed", "stale", "blocked"];
const MANUAL_ONLY = new Set(["similar_reviews", "review_timeline", "full_protocol", "search_strategy_link", "review_stage", "team_members", "funding", "peer_review", "conflict_of_interest"]);
const STOPWORDS = new Set(["this", "that", "with", "from", "will", "have", "been", "were", "their", "into", "review", "study", "studies", "using", "include", "included"]);
const QUESTIONS: Record<string, string> = {
  review_type: "Which PROSPERO review type has the team selected, and why does it match the review question?",
  similar_reviews: "Which PROSPERO and published reviews materially overlap, and what team-approved reason justifies proceeding?",
  review_timeline: "What are the actual start date, expected end date and living-review status as of today?",
  full_protocol: "Has a full protocol been written, and what public URL, DOI or upload status should be reported?",
  search_strategy_link: "Where is the complete reproducible search strategy publicly available or ready for upload?",
  review_stage: "Which review stages are actually started and completed as of submission today?",
  team_members: "Please confirm each member's name, role, email, ORCID, institution, country and guarantor/contact status.",
  funding: "What funding or institutional support exists, including grant number and funder role; or should the team declare no funding?",
  peer_review: "Was the protocol independently peer reviewed, by whom, through what process and with what scope?",
  conflict_of_interest: "What conflict-of-interest declaration has each relevant person explicitly approved?",
};
