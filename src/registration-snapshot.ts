export interface RegistrationConstraintSnapshot {
  key: string;
  route: string;
  required: boolean;
  minimum_words: number | null;
  maximum_words: number | null;
  control_count: number;
}

export const REGISTRATION_SCHEMA_SNAPSHOT_META = {
  captured_at: "2026-07-16T05:15:00Z",
  prospero_release: "2.0.39",
  template_variant: "Intervention",
  field_count: 39,
} as const;

export const REGISTRATION_CONSTRAINTS: RegistrationConstraintSnapshot[] = [
  constraint("review_title", "TemplateTitle", true, 5, 30, 1),
  constraint("review_type", "TemplateReviewType", false, null, null, 2),
  constraint("condition", "TemplateCondition", true, 1, 200, 3),
  constraint("rationale", "TemplateRationale", true, 5, 250, 1),
  constraint("objectives", "TemplateReviewQuestion", true, 10, 200, 1),
  constraint("keywords", "TemplateKeywords", true, null, null, 2),
  constraint("country", "TemplateCountry", true, null, null, 2),
  constraint("population", "TemplatePopulation", true, 5, 200, 2),
  constraint("interventions_exposures", "TemplateIntervention", true, 0, 200, 4),
  constraint("comparators", "TemplateComparator", false, null, null, 3),
  constraint("study_design", "TemplateStudyDesign", true, 0, 250, 4),
  constraint("context", "TemplateContext", true, 5, 250, 1),
  constraint("similar_reviews", "TemplateCheckSimilar", true, null, null, 2),
  constraint("review_timeline", "TemplateReviewTimeline", true, null, null, 2),
  constraint("full_protocol", "TemplatePublishedProtocol", true, null, null, 4),
  constraint("unpublished_studies", "TemplateUnpublishedStudies", true, null, null, 2),
  constraint("search_sources", "TemplateSearchDatabases", true, null, null, 17),
  constraint("language_restrictions", "TemplateSearchLanguage", true, null, null, 2),
  constraint("date_restrictions", "TemplateStudyDateRestrictions", true, null, null, 2),
  constraint("other_identification_methods", "TemplateOtherStudyIDMethods", false, 0, 50, 7),
  constraint("search_strategy_link", "TemplatePublishedSearch", true, null, null, 3),
  constraint("selection_process", "TemplateScreening", true, null, null, 4),
  constraint("search_screening_other", "TemplateScreeningAdditional", false, 0, 250, 1),
  constraint("data_extraction", "TemplateDataExtraction", true, null, null, 7),
  constraint("risk_of_bias", "TemplateRiskOfBias", true, null, null, 2),
  constraint("reporting_bias", "TemplateReportingBias", true, null, null, 2),
  constraint("certainty_assessment", "TemplateCertainty", true, null, null, 2),
  constraint("main_outcomes", "TemplateOutcomesMain", true, 5, 250, 1),
  constraint("additional_outcomes", "TemplateOutcomesAdditional", false, 0, 300, 1),
  constraint("synthesis_strategy", "TemplateDataSynthesis", true, null, null, 2),
  constraint("review_stage", "TemplateReviewStage", true, null, null, 21),
  constraint("publication_results", "TemplateReviewPublication", true, null, null, 2),
  constraint("team_members", "TemplateReviewTeam", true, null, null, 0),
  constraint("affiliation", "TemplateOrgAffil", true, 1, 20, 1),
  constraint("funding", "TemplateFunding", true, 0, 50, 4),
  constraint("peer_review", "TemplatePeerReview", true, null, null, 2),
  constraint("additional_information", "TemplateAdditionalInfo", false, 0, 250, 1),
  constraint("conflict_of_interest", "TemplateConflict", true, null, null, 2),
  constraint("mesh_terms", "TemplateMeSH", false, null, null, 0),
];

export const REGISTRATION_CONSTRAINTS_BY_KEY = new Map(
  REGISTRATION_CONSTRAINTS.map((item) => [item.key, item]),
);

function constraint(
  key: string,
  routeName: string,
  required: boolean,
  minimumWords: number | null,
  maximumWords: number | null,
  controlCount: number,
): RegistrationConstraintSnapshot {
  return {
    key,
    route: `/PROSPERO/register/${routeName}`,
    required,
    minimum_words: minimumWords,
    maximum_words: maximumWords,
    control_count: controlCount,
  };
}
