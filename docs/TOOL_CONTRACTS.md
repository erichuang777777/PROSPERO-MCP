# MCP tool contracts for v0.2.0

## Reliability envelope

Every tool returns either:

```json
{"ok": true, "data": {}}
```

or:

```json
{
  "ok": false,
  "error": {
    "code": "NETWORK_TIMEOUT",
    "message": "PROSPERO did not respond before the timeout.",
    "retryable": true,
    "action": "Retry after PROSPERO recovers."
  }
}
```

## Planned tools

- `prospero_health`: runtime, browser, session and write-guard status.
- `prospero_search_protocols`: public query, facets, filters and sorting.
- `prospero_build_query`: build a PROSPERO query from PICO concepts.
- `prospero_bulk_export`: bounded bulk retrieval and JSON/CSV/RIS export.
- `prospero_get_protocol`: public search-index record.
- `prospero_record_workflow`: full rendered public record and registration entry points.
- `prospero_list_drafts`: all editable drafts with stable identifiers.
- `prospero_get_registration_schema`: current fields/instructions/controls for one selected draft.
- `prospero_generate_workbook`: protocol text/file to external Markdown workbook.
- `prospero_protocol_to_registration`: one-step workbook, validation, PROSPERO discovery, optional PubMed discovery and merged lexical triage. Source failures are isolated as `available`, `empty`, `unavailable` or `skipped`.
- `prospero_validate_registration`: required, format and consistency checks.
- `prospero_similar_reviews`: PROSPERO similarity endpoint.
- `prospero_compare_similar_reviews`: ranked PICO overlap and difference rationale draft.
- `prospero_prepare_registration_patch`: dry-run old/new/provenance/confidence map and confirmation hash.
- `prospero_apply_registration_patch`: guarded allowlisted `Save for later` operation only.
- `prospero_analyze_protocol`: provenance manifest, state machine, interview and consistency report.
- `prospero_validate_search_strategy`: local syntax/concept lint; never claims formal peer review.
- `prospero_compare_protocol_versions`: stable-field changes and advisory amendment classification.
- `prospero_generate_local_preview`: escaped local HTML only.
- `prospero_prepare_clipboard_queue` / `prospero_copy_confirmed_field`: confirmed, non-declaration, single-use local clipboard flow.
- `prospero_monitor_similar_reviews`: confirmed-query public monitoring with local identifier snapshots.
- `prospero_protect_local_artifact` / `prospero_read_protected_artifact`: optional local encryption.

## Stable draft selector

Authenticated tools accept exactly one of:

- `record_id`
- `record_version`
- exact `title`

When no selector is provided and more than one draft exists, the tool returns `DRAFT_SELECTION_REQUIRED`. It never defaults to the first row.

## Optional-source contract

PubMed is an enhancement, not a prerequisite. `prospero_protocol_to_registration` must return the workbook and whichever discovery source succeeded when PubMed has no API key, is disabled, returns zero records, times out, is rate limited, or is unavailable. `include_pubmed=false` must perform no PubMed request.

Protocol-derived external discovery is two-step: the first call returns the exact query plan and SHA-256 confirmation hash with both sources `skipped`; only a second call returning that hash may send the queries.
