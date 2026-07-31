import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { atomicWriteFileSync } from "./atomic-file.js";
import { ProsperoError } from "./errors.js";
import type { RegistrationAnalysisManifest, RegistrationFieldAnalysis } from "./registration-assistant.js";
import { REGISTRATION_CATALOG } from "./registration-catalog.js";
import { assertAllowedOutputPath } from "./safety-policy.js";

export interface AutomationFinding {
  severity: "error" | "warning" | "info";
  code: string;
  fields: string[];
  message: string;
}

export function validateAdvancedConsistency(answers: Record<string, string>): AutomationFinding[] {
  const findings: AutomationFinding[] = [];
  const combined = (keys: string[]) => keys.map((key) => answers[key] ?? "").join(" ").toLowerCase();
  const objective = combined(["objectives"]);
  const eligibility = combined(["population", "interventions_exposures", "comparators", "study_design"]);
  const outcomes = combined(["main_outcomes", "additional_outcomes"]);
  const synthesis = combined(["synthesis_strategy"]);
  if (/meta-analysis|meta analysis/.test(synthesis) && !/(risk ratio|odds ratio|hazard ratio|mean difference|standardized mean|effect measure)/.test(`${outcomes} ${synthesis}`)) {
    findings.push(issue("warning", "META_EFFECT_MEASURE_MISSING", ["main_outcomes", "synthesis_strategy"], "Meta-analysis is planned but no effect measure was detected."));
  }
  if (/network meta/.test(synthesis) && !/(transitivity|inconsisten|network)/.test(synthesis)) {
    findings.push(issue("warning", "NMA_ASSUMPTIONS_MISSING", ["synthesis_strategy"], "Network meta-analysis is mentioned without a transitivity/inconsistency plan."));
  }
  if (/no comparator|does not have any comparator|not applicable/.test((answers.comparators ?? "").toLowerCase()) && /comparative|versus| vs /.test(objective)) {
    findings.push(issue("error", "COMPARATOR_CONFLICT", ["objectives", "comparators"], "The objective is comparative but the comparator field states that no comparator exists."));
  }
  if (/randomized|randomised|rct/.test(eligibility) && /robins-i/.test((answers.risk_of_bias ?? "").toLowerCase()) && !/non-random/.test(eligibility)) {
    findings.push(issue("warning", "ROB_TOOL_DESIGN_MISMATCH", ["study_design", "risk_of_bias"], "ROBINS-I was detected for an apparently RCT-only review; confirm the tool matches included designs."));
  }
  if (outcomes && !/(time|week|month|year|follow-up|follow up|baseline|discharge|survival)/.test(outcomes)) {
    findings.push(issue("warning", "OUTCOME_TIMEPOINT_MISSING", ["main_outcomes", "additional_outcomes"], "No outcome time point or timing definition was detected."));
  }
  if (/english only|only.*english/.test(combined(["language_restrictions", "context"])) && /no language restriction/.test(combined(["language_restrictions", "search_screening_other"]))) {
    findings.push(issue("error", "LANGUAGE_RESTRICTION_CONFLICT", ["language_restrictions", "context", "search_screening_other"], "Conflicting language restriction statements were detected."));
  }
  if (/single reviewer|one reviewer/.test(combined(["selection_process"])) && /two|dual|independent/.test(combined(["data_extraction"]))) {
    findings.push(issue("info", "REVIEWER_PROCESS_DIFFERENCE", ["selection_process", "data_extraction"], "Screening and extraction use different reviewer models; confirm this is intentional."));
  }
  return findings;
}

export function validateSearchStrategy(strategy: string, concepts: Record<string, string[]> = {}, platform?: string): AutomationFinding[] {
  const findings: AutomationFinding[] = [];
  if (!strategy.trim()) return [issue("error", "SEARCH_EMPTY", ["search_strategy"], "Search strategy is empty.")];
  if (!balanced(strategy, "(", ")")) findings.push(issue("error", "UNBALANCED_PARENTHESES", ["search_strategy"], "Search parentheses are not balanced."));
  if (!/\b(AND|OR)\b/.test(strategy)) findings.push(issue("warning", "BOOLEAN_MISSING", ["search_strategy"], "No uppercase Boolean operators were detected."));
  if (/\bNOT\b/.test(strategy)) findings.push(issue("warning", "NOT_REQUIRES_REVIEW", ["search_strategy"], "NOT can remove relevant studies and requires explicit human justification."));
  if (platform && /pubmed/i.test(platform) && /\.mp\.|adj\d*|exp\s+/i.test(strategy)) findings.push(issue("error", "PLATFORM_SYNTAX_MISMATCH", ["search_strategy"], "Ovid syntax was detected in a PubMed strategy."));
  if (platform && /ovid/i.test(platform) && /\[(?:tiab|mesh|pt|sb)\]/i.test(strategy)) findings.push(issue("error", "PLATFORM_SYNTAX_MISMATCH", ["search_strategy"], "PubMed field tags were detected in an Ovid strategy."));
  for (const [concept, terms] of Object.entries(concepts)) {
    if (terms.length && !terms.some((term) => strategy.toLowerCase().includes(term.toLowerCase()))) {
      findings.push(issue("warning", "CONCEPT_NOT_FOUND", [concept], `No supplied ${concept} term was found in the search strategy.`));
    }
  }
  if (!/(mesh|emtree|subject heading|exp\s|\/)/i.test(strategy)) findings.push(issue("info", "CONTROLLED_VOCABULARY_NOT_DETECTED", ["search_strategy"], "No controlled-vocabulary syntax was detected; confirm whether it is appropriate for this database."));
  return findings;
}

export function compareRegistrationVersions(oldAnswers: Record<string, string>, newAnswers: Record<string, string>) {
  const changes = REGISTRATION_CATALOG.flatMap((field) => {
    const before = normalize(oldAnswers[field.key] ?? "");
    const after = normalize(newAnswers[field.key] ?? "");
    if (before === after) return [];
    return [{
      key: field.key,
      title: field.title,
      before: oldAnswers[field.key] ?? "",
      after: newAnswers[field.key] ?? "",
      classification: MAJOR_METHOD_FIELDS.has(field.key) ? "potential_major_revision" : "minor_or_administrative",
    }];
  });
  return {
    changed_fields: changes.length,
    changes,
    potential_major_revision: changes.some((change) => change.classification === "potential_major_revision"),
    note: "Revision classification is advisory; confirm the current PROSPERO amendment rules before acting.",
  };
}

export function renderRegistrationPreview(manifest: RegistrationAnalysisManifest): string {
  const rows = manifest.fields.map((field) => `<section><h2>${escapeHtml(field.title)}</h2><p class="meta">${escapeHtml(field.key)} · ${escapeHtml(field.state)} · ${field.word_count} words</p><pre>${escapeHtml(field.answer || "[MISSING]")}</pre><p>Source: ${escapeHtml(sourceLabel(field))}</p></section>`).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>PROSPERO Local Preview</title><style>body{font-family:Arial,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;color:#17212b}section{border-top:1px solid #ccd5dd;padding:1rem 0}pre{white-space:pre-wrap;background:#f5f7f9;padding:1rem}.meta{color:#52606d}.warning{background:#fff3cd;padding:1rem}</style></head><body><h1>PROSPERO registration local preview</h1><p class="warning">Local draft only. This preview does not submit or modify a PROSPERO record.</p><p>Generated ${escapeHtml(manifest.generated_at)} · Blocking fields: ${manifest.blocking_fields.length}</p>${rows}</body></html>`;
}

export function prepareClipboardQueue(manifest: RegistrationAnalysisManifest): { queue_id: string; path: string; fields: string[] } {
  const safeFields = manifest.fields.filter((field) => field.state === "confirmed" && !DECLARATION_FIELDS.has(field.key));
  if (!safeFields.length) throw new ProsperoError({ code: "VALIDATION_ERROR", message: "No confirmed non-declaration fields are available for the clipboard queue.", retryable: false, action: "Confirm source-grounded fields first." });
  const queueId = hash(JSON.stringify(safeFields.map((field) => [field.key, field.answer, field.provenance.source_hash])));
  const directory = path.resolve(process.env.PROSPERO_CLIPBOARD_DIR ?? ".prospero-clipboard");
  mkdirSync(directory, { recursive: true });
  const queuePath = path.join(directory, `${queueId}.json`);
  atomicWriteFileSync(queuePath, JSON.stringify({ version: 1, queue_id: queueId, created_at: new Date().toISOString(), items: safeFields.map((field) => ({ key: field.key, title: field.title, value: field.answer, copied_at: null })) }, null, 2), { mode: 0o600 });
  return { queue_id: queueId, path: queuePath, fields: safeFields.map((field) => field.key) };
}

export async function copyConfirmedQueueField(queueId: string, key: string, confirmationHash: string) {
  if (process.env.PROSPERO_ENABLE_CLIPBOARD !== "true") throw new ProsperoError({ code: "WRITE_DISABLED", message: "Clipboard assistance is disabled.", retryable: false, action: "Set PROSPERO_ENABLE_CLIPBOARD=true locally only when you are ready to paste reviewed fields." });
  if (queueId !== confirmationHash) throw new ProsperoError({ code: "WRITE_CONFIRMATION_REQUIRED", message: "Clipboard queue confirmation does not match.", retryable: false, action: "Return the reviewed queue_id exactly." });
  const queuePath = path.resolve(process.env.PROSPERO_CLIPBOARD_DIR ?? ".prospero-clipboard", `${queueId}.json`);
  if (!existsSync(queuePath)) throw new ProsperoError({ code: "WRITE_CONFIRMATION_REQUIRED", message: "Clipboard queue receipt was not found.", retryable: false, action: "Prepare a new queue." });
  let queue: { items: Array<{ key: string; title: string; value: string; copied_at: string | null }> };
  try {
    queue = JSON.parse(readFileSync(queuePath, "utf8")) as { items: Array<{ key: string; title: string; value: string; copied_at: string | null }> };
  } catch (error) {
    throw new ProsperoError({ code: "WRITE_CONFIRMATION_REQUIRED", message: "The clipboard queue file is corrupt.", retryable: false, action: "Prepare a new queue." }, { cause: error });
  }
  const item = queue.items.find((entry) => entry.key === key);
  if (!item || item.copied_at) throw new ProsperoError({ code: "WRITE_CONFIRMATION_REQUIRED", message: "Clipboard item is missing or already copied.", retryable: false, action: "Review the queue and select an uncopied field." });
  const { default: clipboard } = await import("clipboardy");
  await clipboard.write(item.value);
  item.copied_at = new Date().toISOString();
  atomicWriteFileSync(queuePath, JSON.stringify(queue, null, 2), { mode: 0o600 });
  const auditPath = path.join(path.dirname(queuePath), "audit.jsonl");
  appendFileSync(auditPath, `${JSON.stringify({ timestamp: item.copied_at, queue_id: queueId, key, value_sha256: hash(item.value) })}\n`, { encoding: "utf8", mode: 0o600 });
  const clearAfterMs = Number(process.env.PROSPERO_CLIPBOARD_CLEAR_MS ?? 60_000);
  const timer = setTimeout(async () => { try { if (await clipboard.read() === item.value) await clipboard.write(""); } catch {} }, Math.max(1_000, clearAfterMs));
  timer.unref();
  return { key: item.key, title: item.title, copied: true, copied_at: item.copied_at, value_returned: false };
}

export function writePreviewFile(outputPath: string, html: string): string {
  const safePath = assertAllowedOutputPath(outputPath);
  atomicWriteFileSync(safePath, html, { encoding: "utf8", mode: 0o600 });
  return safePath;
}

export function compareSimilarSnapshot(previous: string[], current: string[]) {
  const before = new Set(previous);
  const now = new Set(current);
  return { added: current.filter((id) => !before.has(id)), removed: previous.filter((id) => !now.has(id)), unchanged: current.filter((id) => before.has(id)), stale: !previous.length };
}

function sourceLabel(field: RegistrationFieldAnalysis): string {
  const location = [field.provenance.file, field.provenance.page ? `page ${field.provenance.page}` : null, field.provenance.section].filter(Boolean).join(" · ");
  return location || field.provenance.source;
}

function issue(severity: AutomationFinding["severity"], code: string, fields: string[], message: string): AutomationFinding {
  return { severity, code, fields, message };
}
function balanced(value: string, open: string, close: string): boolean { let count = 0; for (const char of value) { if (char === open) count += 1; if (char === close) count -= 1; if (count < 0) return false; } return count === 0; }
function normalize(value: string): string { return value.replace(/\s+/g, " ").trim(); }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!); }

const MAJOR_METHOD_FIELDS = new Set(["objectives", "population", "interventions_exposures", "comparators", "study_design", "main_outcomes", "additional_outcomes", "search_sources", "selection_process", "risk_of_bias", "synthesis_strategy"]);
const DECLARATION_FIELDS = new Set(["team_members", "funding", "peer_review", "conflict_of_interest", "review_stage", "review_timeline", "similar_reviews"]);
