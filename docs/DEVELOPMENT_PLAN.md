# PROSPERO MCP v0.2.0 development plan

## Objective

Turn the v0.1 read-only integration into a guarded registration assistant that can discover drafts, capture the current registration schema, generate and validate draft answers, compare similar reviews, and optionally save individually approved fields without ever completing or submitting a registration.

## Delivery phases

### Phase 1: reliability and security

- Stable machine-readable error codes and recovery actions.
- Retry/backoff for transient API and browser failures.
- Session presence, validity and expiry diagnostics.
- Windows DPAPI encryption for locally persisted session state.
- Sanitized diagnostics that never include tokens, passwords or full user objects.

### Phase 2: registration discovery

- List all editable drafts instead of selecting the first table row.
- Select a draft by stable record/version identifier or exact title.
- Extract current sections, fields, routes, instructions, required state, controls and validation limits.
- Detect selector/schema drift explicitly.

### Phase 3: preparation and validation

- Read protocol text from Markdown, TXT, PDF and DOCX.
- Produce the 12-section/39-field external workbook.
- Validate required fields, word limits, dates and cross-field consistency.
- Build proposed field changes with provenance and confidence.

### Phase 4: evidence discovery and export

- Build PROSPERO queries from PICO concepts.
- Rank and compare similar reviews by PICO overlap.
- Bulk-fetch record details with bounded concurrency.
- Export JSON, CSV and RIS.

### Phase 5: guarded write assistance

- Writes disabled unless `PROSPERO_ENABLE_WRITES=true`.
- Require draft identifier, explicit field allowlist and confirmation token.
- Display old/new values before execution.
- Permit only field entry and `Save for later`.
- Prohibit Mark as complete, Submit, Delete, Withdraw and author approval.
- Write a sanitized local audit record.

### Phase 6: quality and release

- Unit tests, HTML fixtures and mocked browser/API integration tests.
- Live read-only smoke test.
- GitHub Actions build/test/pack/secret checks.
- Package allowlist and clean-install verification.

## Definition of done

- Every MCP tool returns stable structured success or failure data.
- No tool silently chooses among multiple drafts.
- Workbook/schema output is traceable to live PROSPERO or a labelled bundled fallback.
- Validation never claims that a methodological recommendation is a PROSPERO rule.
- Write operations cannot reach submission controls.
- Authentication material remains local, encrypted where supported, Git-ignored and absent from release artifacts.
