export type ProsperoSortField = "title" | "accession" | "year";
export type ProsperoSortOrder = "asc" | "desc";
export type ProsperoFilterName =
  | "recordtype"
  | "reviewstatus"
  | "dateinprospero"
  | "yearfirstpublished"
  | "region"
  | "funders";

export interface ProsperoSearchFilter {
  name: ProsperoFilterName;
  value: string[];
}

export interface ProsperoSimilarReviewInput {
  recordversion?: number | undefined;
  title: string;
  review_question: string;
  condition?: string | undefined;
  intervention?: string | undefined;
  comparator?: string | undefined;
  outcomes?: string | undefined;
  threshold?: number | undefined;
}

export interface ProsperoSimilarReview {
  record_id: string;
  accession_number: string;
  title: string;
  review_question: string;
  first_published: string | null;
  score: number | null;
  raw: Record<string, unknown>;
}

export interface ProsperoRecordSectionItem {
  title: string;
  content: string;
  html: string;
}

export interface ProsperoRecordSection {
  title: string;
  items: ProsperoRecordSectionItem[];
}

export interface ProsperoRecordPage {
  accession_number: string;
  record_url: string;
  title: string;
  authors: string;
  citation: string;
  sections: ProsperoRecordSection[];
  raw_html_length: number;
}

export type ProsperoRecordWorkflowMode =
  | "view_record"
  | "start_registration"
  | "myprospero"
  | "register_checklist";

export interface ProsperoBrowserPageSnapshot {
  requested_url: string;
  final_url: string;
  title: string;
  body_text: string;
  html_length: number;
  login_required: boolean;
}

export interface ProsperoRegistrationStartResult extends ProsperoBrowserPageSnapshot {
  next_steps: string[];
}

export interface ProsperoRegisterChecklistItem {
  title: string;
  status: string;
  active: boolean;
  html: string;
}

export interface ProsperoRegisterChecklistSection {
  title: string;
  expanded: boolean;
  progress: Array<{
    value_now: number | null;
    value_max: number | null;
    class_name: string;
    width: string;
  }>;
  intro_text: string;
  items: ProsperoRegisterChecklistItem[];
}

export interface ProsperoRegisterChecklistResult extends ProsperoBrowserPageSnapshot {
  page_heading: string;
  banner_text: string;
  action_buttons: string[];
  sections: ProsperoRegisterChecklistSection[];
}

export interface ProsperoDraft {
  record_id: number;
  accession_number: string;
  record_version_id: string;
  template_id: string;
  template_variant: string;
  purpose: string;
  publication_status: string;
  editing_status: string;
  title: string;
  created_at: string;
  last_edited_at: string;
  editable: boolean;
}

export interface ProsperoDraftSelector {
  record_id?: number | undefined;
  record_version_id?: string | undefined;
  title?: string | undefined;
}

export interface ProsperoRegistrationControl {
  tag: string;
  type: string;
  name: string;
  id: string;
  label: string;
  required: boolean;
  placeholder: string;
  options: string[];
  context: string;
  value: string;
  checked: boolean | null;
}

export interface ProsperoRegistrationSchemaField {
  section: string;
  title: string;
  status: string;
  route: string | null;
  instructions: string | null;
  required: boolean | null;
  minimum_words: number | null;
  maximum_words: number | null;
  controls: ProsperoRegistrationControl[];
  detail_captured: boolean;
}

export interface ProsperoRegistrationSchemaSection {
  title: string;
  intro_text: string;
  fields: ProsperoRegistrationSchemaField[];
}

export interface ProsperoRegistrationSchema {
  captured_at: string;
  source: "live";
  draft: ProsperoDraft;
  sections: ProsperoRegistrationSchemaSection[];
  total_fields: number;
  detailed_fields: number;
}

export interface ProsperoSearchArgs {
  query: string;
  page?: number | undefined;
  page_size?: number | undefined;
  field?: "ALL" | "TI" | "AN" | "RQ" | "CS" | "IV" | "OP" | "PA" | "KW" | "CM" | "CO" | "FU" | "OA" | "OS" | undefined;
  sort?: ProsperoSortField | undefined;
  sort_order?: ProsperoSortOrder | undefined;
  filters?: ProsperoSearchFilter[] | undefined;
  record_type?: string[] | undefined;
  review_status?: string[] | undefined;
  year_in_prospero?: string[] | undefined;
  date_registered_start?: string | undefined;
  date_registered_end?: string | undefined;
}

export interface ProsperoConfig {
  baseUrl: string;
  accessToken: string;
  authToken: string | undefined;
  timeoutMs: number;
}

export interface ProsperoHit {
  record_id: string;
  accession_number: string;
  title: string;
  review_status: string | null;
  editing_status: string | null;
  living_status: string | null;
  year_first_published: number | null;
  raw: Record<string, unknown>;
}

export interface ProsperoSearchPage {
  page: number;
  page_size: number;
  query: string;
  total_hits: number;
  hits: ProsperoHit[];
  aggregations: Record<string, unknown>;
  raw_note: string | undefined;
}
