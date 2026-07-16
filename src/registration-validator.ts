import { REGISTRATION_CATALOG } from "./registration-catalog.js";
import { REGISTRATION_CONSTRAINTS, REGISTRATION_SCHEMA_SNAPSHOT_META } from "./registration-snapshot.js";
import type { ProsperoRegistrationSchema } from "./types.js";

export interface RegistrationValidationIssue {
  severity: "error" | "warning" | "info";
  code: string;
  fields: string[];
  message: string;
  basis: "live_schema" | "schema_snapshot" | "confirmed_rule" | "methodological_check";
}

export interface RegistrationValidationResult {
  valid: boolean;
  completeness_percent: number;
  answered_fields: number;
  total_fields: number;
  issues: RegistrationValidationIssue[];
}

export function validateRegistration(
  answers: Record<string, unknown>,
  schema?: ProsperoRegistrationSchema,
  options: { require_complete?: boolean } = {},
): RegistrationValidationResult {
  const normalized = normalizeAnswers(answers);
  const issues: RegistrationValidationIssue[] = [];
  const knownKeys = new Set(REGISTRATION_CATALOG.map((field) => field.key));
  for (const key of Object.keys(normalized)) {
    if (!knownKeys.has(key)) {
      issues.push({
        severity: "warning",
        code: "UNKNOWN_FIELD",
        fields: [key],
        message: `Unknown registration field key: ${key}.`,
        basis: "methodological_check",
      });
    }
  }

  validateTitle(normalized.review_title, issues);
  if (!normalized.objectives) missingRecommended("objectives", issues);
  if (!normalized.population) missingRecommended("population", issues);
  if (!normalized.study_design) missingRecommended("study_design", issues);
  if (!normalized.search_sources) missingRecommended("search_sources", issues);
  if (!normalized.main_outcomes) missingRecommended("main_outcomes", issues);
  if (!normalized.synthesis_strategy) missingRecommended("synthesis_strategy", issues);

  if (schema) validateLiveSchema(normalized, schema, issues);
  else validateSnapshot(normalized, issues, options.require_complete ?? false);
  validateDates(normalized, issues);
  validateConsistency(normalized, issues);

  const answeredFields = REGISTRATION_CATALOG.filter((field) => Boolean(normalized[field.key])).length;
  return {
    valid: !issues.some((issue) => issue.severity === "error"),
    completeness_percent: Math.round((answeredFields / REGISTRATION_CATALOG.length) * 100),
    answered_fields: answeredFields,
    total_fields: REGISTRATION_CATALOG.length,
    issues,
  };
}

function validateSnapshot(
  answers: Record<string, string>,
  issues: RegistrationValidationIssue[],
  requireComplete: boolean,
) {
  for (const constraint of REGISTRATION_CONSTRAINTS) {
    const value = answers[constraint.key];
    if (constraint.required && !value && requireComplete) {
      issues.push({
        severity: "error",
        code: "SNAPSHOT_REQUIRED_FIELD",
        fields: [constraint.key],
        message: `${constraint.key} is required in the ${REGISTRATION_SCHEMA_SNAPSHOT_META.template_variant} schema snapshot captured from PROSPERO ${REGISTRATION_SCHEMA_SNAPSHOT_META.prospero_release}.`,
        basis: "schema_snapshot",
      });
    }
    if (!value) continue;
    const words = countWords(value);
    if (constraint.minimum_words !== null && words < constraint.minimum_words) {
      issues.push({
        severity: "error",
        code: "SNAPSHOT_MIN_WORDS",
        fields: [constraint.key],
        message: `${constraint.key} has ${words} words; the schema snapshot minimum is ${constraint.minimum_words}.`,
        basis: "schema_snapshot",
      });
    }
    if (constraint.maximum_words !== null && words > constraint.maximum_words) {
      issues.push({
        severity: "error",
        code: "SNAPSHOT_MAX_WORDS",
        fields: [constraint.key],
        message: `${constraint.key} has ${words} words; the schema snapshot maximum is ${constraint.maximum_words}.`,
        basis: "schema_snapshot",
      });
    }
  }
}

function validateTitle(value: string | undefined, issues: RegistrationValidationIssue[]) {
  if (!value) {
    issues.push({ severity: "error", code: "TITLE_REQUIRED", fields: ["review_title"], message: "Review title is required.", basis: "confirmed_rule" });
    return;
  }
  const words = countWords(value);
  if (words < 5 || words > 30) {
    issues.push({
      severity: "error",
      code: "TITLE_WORD_LIMIT",
      fields: ["review_title"],
      message: `Review title has ${words} words; the confirmed PROSPERO limit is 5-30 words.`,
      basis: "confirmed_rule",
    });
  }
}

function validateLiveSchema(
  answers: Record<string, string>,
  schema: ProsperoRegistrationSchema,
  issues: RegistrationValidationIssue[],
) {
  const byTitle = new Map(REGISTRATION_CATALOG.map((field) => [field.title.toLowerCase(), field.key]));
  for (const field of schema.sections.flatMap((section) => section.fields)) {
    const key = byTitle.get(field.title.toLowerCase());
    if (!key) continue;
    const value = answers[key];
    if (field.required === true && !value) {
      issues.push({ severity: "error", code: "LIVE_REQUIRED_FIELD", fields: [key], message: `${field.title} is required by the captured live schema.`, basis: "live_schema" });
    }
    if (value && (field.minimum_words !== null || field.maximum_words !== null)) {
      const words = countWords(value);
      if (field.minimum_words !== null && words < field.minimum_words) {
        issues.push({ severity: "error", code: "LIVE_MIN_WORDS", fields: [key], message: `${field.title} requires at least ${field.minimum_words} words; found ${words}.`, basis: "live_schema" });
      }
      if (field.maximum_words !== null && words > field.maximum_words) {
        issues.push({ severity: "error", code: "LIVE_MAX_WORDS", fields: [key], message: `${field.title} allows at most ${field.maximum_words} words; found ${words}.`, basis: "live_schema" });
      }
    }
  }
}

function validateDates(answers: Record<string, string>, issues: RegistrationValidationIssue[]) {
  const start = answers.review_start_date ? Date.parse(answers.review_start_date) : NaN;
  const end = answers.review_end_date ? Date.parse(answers.review_end_date) : NaN;
  if (Number.isFinite(start) && Number.isFinite(end) && start > end) {
    issues.push({ severity: "error", code: "TIMELINE_ORDER", fields: ["review_start_date", "review_end_date"], message: "Review start date is after the anticipated completion date.", basis: "methodological_check" });
  }
}

function validateConsistency(answers: Record<string, string>, issues: RegistrationValidationIssue[]) {
  const language = answers.language_restrictions?.toLowerCase() ?? "";
  const context = answers.context?.toLowerCase() ?? "";
  if (language.includes("english only") && context.includes("no language restriction")) {
    issues.push({ severity: "error", code: "LANGUAGE_CONTRADICTION", fields: ["language_restrictions", "context"], message: "Language restrictions conflict with the Context answer.", basis: "methodological_check" });
  }
  if ((answers.review_type?.toLowerCase().includes("intervention") || answers.interventions_exposures) && !answers.comparators) {
    issues.push({ severity: "warning", code: "COMPARATOR_UNCLEAR", fields: ["review_type", "comparators"], message: "The review appears intervention-focused but no comparator/control answer is provided.", basis: "methodological_check" });
  }
  if (/data extraction\s*[:=-]?\s*(started|yes|complete)/i.test(answers.review_stage ?? "")) {
    issues.push({ severity: "warning", code: "REGISTRATION_TIMING_REVIEW", fields: ["review_stage"], message: "Data extraction appears to have started; confirm current PROSPERO eligibility and accurately report the stage.", basis: "methodological_check" });
  }
}

function missingRecommended(key: string, issues: RegistrationValidationIssue[]) {
  issues.push({ severity: "warning", code: "CORE_FIELD_EMPTY", fields: [key], message: `Core methodological field ${key} is empty.`, basis: "methodological_check" });
}

function normalizeAnswers(answers: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(answers).flatMap(([key, value]) => {
    if (typeof value === "string") return [[key, value.trim()]];
    if (Array.isArray(value)) return [[key, value.map(String).join("; ").trim()]];
    if (value === null || value === undefined) return [];
    return [[key, String(value).trim()]];
  }));
}

function countWords(value: string): number {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}
