# Changelog

## Unreleased

## 0.2.1 - 2026-07-31

### Fixed

- Hardened the isolated document parser: strip secret-shaped environment variables from the untrusted-input subprocess and correctly classify timeouts via `ETIMEDOUT`.
- Capped cumulative PDF page text so large multi-page documents no longer overflow the parser `maxBuffer`.
- Serialized the PubMed E-utilities rate limiter so concurrent searches honour the NCBI interval.
- Made `atomicWriteFileSync` durable (`fsync` before rename) and closed a stale-lock takeover race in `withFileLock`.
- Bounded the interactive login wait with a finite, configurable timeout (`PROSPERO_LOGIN_TIMEOUT_MS`) and treat closing the window as a graceful abort.
- Guarded untrusted `JSON.parse` on protected artifacts, similar-review snapshots and the clipboard queue; corrupt files now raise structured errors instead of crashing.
- `consumePreparedPatchReceipt` no longer throws back to the caller after a successful save, preventing a spurious error from masking a completed write.
- Routed user-facing export/workbook writes through atomic writes, tightened the outbound phone-number scan to avoid false positives on registry identifiers, and surfaced a clear `CONFIG_ERROR` for missing allowlist directories.

### Security

- Upgraded `@modelcontextprotocol/sdk`, `playwright-core` and `cheerio`, clearing all `npm audit` advisories (`fast-uri`, `@hono/node-server`).

## 0.2.0 - 2026-07-16

### Added

- Packaged one shared core as a stdio MCP server, machine-readable `prospero` CLI, and installable `prospero-research` Codex skill.
- Added structured CLI errors/exit codes, read-only discovery and authoring commands, and a non-overwriting skill installer.
- Added core/authoring/full tool profiles and summary/standard/full response modes.
- Added lazy browser/document/clipboard loading, bounded isolated PDF/DOCX parsing and a declaration/source-map-free release build.
- Added opt-in auto-clearing clipboard access, two-step protected-artifact plaintext release, atomic local writes and per-draft locks.
- Added a TTL cache for public PROSPERO/PubMed metadata with offline stale fallback; credentials and protocol text are never cached.
- Added fail-closed path roots, offline mode, outbound privacy scanning and two-step external-query confirmation.
- Added source/page/line provenance, field states, missing-information interviews and stale-confirmation detection.
- Added advanced consistency/search-strategy lint, local HTML preview, single-use clipboard queue, version diff and similar-review monitoring.
- Added optional DPAPI/AES-256-GCM local artifact protection while retaining permanent no-submit/no-delete prohibitions.
- Added a blank, extraction-compatible 39-field PROSPERO protocol template and a section-by-section Chinese writing guide.
- Added `prospero_protocol_to_registration` for protocol-to-workbook generation plus combined PROSPERO and PubMed similar-review discovery.
- Added an optional NCBI E-utilities client with no required API key and explicit empty/unavailable/skipped source states.
- Added cross-source title deduplication, lexical triage, draft difference rationales and safe PROSPERO-only degradation.
- Added PubMed XML, no-key, zero-result, disabled-source and unavailable-source tests.

- Structured error envelope and retry/backoff for transient PROSPERO failures.
- Windows DPAPI protection and expiry diagnostics for saved sessions.
- Stable multi-draft discovery and explicit draft selection.
- Live 39-field registration schema, instructions, controls and word-limit capture.
- TXT/Markdown/PDF/DOCX protocol import and generated registration workbook.
- Registration completeness, live-rule and methodological consistency validator.
- PICO query builder, bulk JSON/CSV/RIS export and similar-review comparison drafts.
- Dry-run registration patches with provenance, confidence and confirmation hashes.
- Disabled-by-default, allowlisted `Save for later` assistance with sanitized audit logs.
- HTML parser fixtures, selector-drift errors, expanded unit tests and GitHub Actions CI.

### Safety

- Mark complete, submit, delete, withdraw, release and author-approval automation remain permanently unsupported.

## 0.1.0 - 2026-07-16

Initial release.

### Included

- Search PROSPERO protocols with pagination, field selection, sorting and filters.
- Retrieve public record details and all rendered record sections.
- Check PROSPERO similar reviews.
- Inspect My PROSPERO, registration coversheet and the active draft checklist.
- Persist PROSPERO `sessionStorage` authentication in a Git-ignored local browser profile.
- Guided first-time setup with browser discovery, website login and live verification.
- Released-package commands: `prospero-mcp`, `prospero-mcp-setup` and `prospero-mcp-login`.
- External registration workbook matching 12 PROSPERO sections and 39 fields.
- Explicit Git exclusions and npm package allowlist for sessions, environment files, logs and downloaded research files.

### Safety boundaries

- No automatic PROSPERO registration submission.
- No terminal collection or storage of the PROSPERO password.
- Registration answers remain manual-review and manual-paste workflows.

### Known limitation

- PROSPERO endpoints can intermittently time out; retry failed read-only operations after the site recovers.
