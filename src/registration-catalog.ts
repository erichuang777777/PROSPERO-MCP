export interface RegistrationCatalogField {
  key: string;
  section: string;
  title: string;
  automation: "draft" | "organize_confirm" | "manual";
  protocol_headings: string[];
}

const entries: Array<[string, string, RegistrationCatalogField["automation"], string[]]> = [
  ["review_title", "Review title", "draft", ["title"]],
  ["review_type", "Review type", "organize_confirm", ["review type", "study type"]],
  ["condition", "Condition or domain being studied", "draft", ["condition", "background", "clinical domain"]],
  ["rationale", "Rationale for the review", "draft", ["rationale", "background", "research gap"]],
  ["objectives", "Review objectives", "draft", ["objective", "aim", "review question"]],
  ["keywords", "Keywords", "draft", ["keywords", "mesh"]],
  ["country", "Country", "organize_confirm", ["country", "affiliation"]],
  ["population", "Population", "draft", ["population", "participants", "eligibility criteria"]],
  ["interventions_exposures", "Intervention(s) or exposure(s)", "draft", ["intervention", "exposure"]],
  ["comparators", "Comparator(s) or control(s)", "draft", ["comparator", "control"]],
  ["study_design", "Study design", "draft", ["study design", "eligible studies", "inclusion criteria"]],
  ["context", "Context", "draft", ["context", "setting"]],
  ["similar_reviews", "Check for similar records already in PROSPERO", "organize_confirm", ["related reviews", "existing reviews"]],
  ["review_timeline", "Review timeline", "organize_confirm", ["timeline", "start date", "completion date"]],
  ["full_protocol", "Availability of full protocol", "organize_confirm", ["protocol availability", "registration"]],
  ["unpublished_studies", "Search for unpublished studies", "organize_confirm", ["grey literature", "unpublished studies"]],
  ["search_sources", "Main sources that will be searched", "draft", ["information sources", "databases", "search strategy"]],
  ["language_restrictions", "Search language restrictions", "organize_confirm", ["language restrictions", "language"]],
  ["date_restrictions", "Search date restrictions", "organize_confirm", ["date restrictions", "search dates"]],
  ["other_identification_methods", "Other methods of identifying studies", "draft", ["citation searching", "other sources", "grey literature"]],
  ["search_strategy_link", "Link to search strategy", "manual", ["search strategy", "appendix"]],
  ["selection_process", "Selection process", "draft", ["study selection", "screening", "selection process"]],
  ["search_screening_other", "Other relevant information about searching and screening", "draft", ["deduplication", "screening software"]],
  ["data_extraction", "Data extraction from published articles and reports", "draft", ["data extraction", "data collection"]],
  ["risk_of_bias", "Study risk of bias or quality assessment", "draft", ["risk of bias", "quality assessment"]],
  ["reporting_bias", "Reporting bias assessment", "draft", ["reporting bias", "publication bias"]],
  ["certainty_assessment", "Certainty assessment", "draft", ["certainty", "grade", "cerqual"]],
  ["main_outcomes", "Main outcomes", "draft", ["primary outcomes", "main outcomes", "outcomes"]],
  ["additional_outcomes", "Additional outcomes", "draft", ["secondary outcomes", "additional outcomes", "harms"]],
  ["synthesis_strategy", "Strategy for data synthesis", "draft", ["data synthesis", "statistical analysis", "analysis plan"]],
  ["review_stage", "Stage of the review at this submission", "manual", ["review stage", "project status"]],
  ["publication_results", "Publication of review results", "organize_confirm", ["dissemination", "publication"]],
  ["team_members", "Review team members", "manual", ["authors", "review team", "contributors"]],
  ["affiliation", "Review affiliation", "organize_confirm", ["affiliation", "institution"]],
  ["funding", "Funding source", "manual", ["funding", "support"]],
  ["peer_review", "Peer review", "manual", ["peer review"]],
  ["additional_information", "Additional information", "draft", ["additional information", "amendments"]],
  ["conflict_of_interest", "Review conflict of interest", "manual", ["conflict of interest", "competing interests"]],
  ["mesh_terms", "Medical Subject Headings", "draft", ["mesh", "subject headings", "keywords"]],
];

const sectionSizes: Array<[string, number]> = [
  ["REVIEW TITLE AND BASIC DETAILS", 7],
  ["ELIGIBILITY CRITERIA", 5],
  ["SIMILAR REVIEWS", 1],
  ["TIMELINE OF THE REVIEW", 1],
  ["AVAILABILITY OF FULL PROTOCOL", 1],
  ["SEARCHING AND SCREENING", 8],
  ["DATA COLLECTION PROCESS", 4],
  ["OUTCOMES TO BE ANALYSED", 2],
  ["PLANNED DATA SYNTHESIS", 1],
  ["CURRENT REVIEW STAGE", 2],
  ["REVIEW AFFILIATION, FUNDING AND PEER REVIEW", 4],
  ["ADDITIONAL INFORMATION", 3],
];

export const REGISTRATION_CATALOG: RegistrationCatalogField[] = (() => {
  const result: RegistrationCatalogField[] = [];
  let offset = 0;
  for (const [section, size] of sectionSizes) {
    for (const [key, title, automation, protocolHeadings] of entries.slice(offset, offset + size)) {
      result.push({ key, section, title, automation, protocol_headings: protocolHeadings });
    }
    offset += size;
  }
  return result;
})();

export function findCatalogField(keyOrTitle: string): RegistrationCatalogField | undefined {
  const normalized = keyOrTitle.trim().toLowerCase();
  return REGISTRATION_CATALOG.find(
    (field) => field.key.toLowerCase() === normalized || field.title.toLowerCase() === normalized,
  );
}
