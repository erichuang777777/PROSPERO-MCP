---
name: prospero-research
description: Search and inspect public PROSPERO records, discover similar PROSPERO and PubMed reviews, extract TXT/Markdown/PDF/DOCX protocols into source-traceable registration drafts, validate all 39 registration fields, inspect authenticated draft schemas, and prepare safe manual-paste workflows. Use when an agent needs PROSPERO protocol discovery, duplicate-review checking, protocol-to-registration drafting, registration completeness checks, or read-only My PROSPERO assistance.
---

# PROSPERO Research

Use the `prospero` MCP tools when available. Fall back to the `prospero` CLI for terminal automation or environments without MCP. Read [references/commands.md](references/commands.md) only when exact tool or CLI syntax is needed.

## Workflow

1. Call `prospero_health` or `prospero health` before work that depends on network, browser login, or local path policy.
2. Search PROSPERO before drafting. Use filters for status, year, and record type. Fetch promising CRD records and compare eligibility criteria, objectives, and outcomes.
3. For a supplied protocol, analyze locally first. Preserve source quotes, page/line locations, confidence, missing fields, and fields requiring human confirmation.
4. Preview protocol-derived outbound queries. Send them only after the user or calling workflow returns the exact confirmation hash. PubMed is supplementary; keep working with PROSPERO-only results if PubMed is absent.
5. Generate and validate a workbook outside PROSPERO. Treat extracted text as a draft, not verified truth. Never invent team, funding, conflict, peer-review, timeline, or declaration answers.
6. If login is available, inspect draft lists and live registration schema read-only. Prefer manual paste. Use clipboard assistance only when explicitly enabled and only for reviewed, non-declaration fields.
7. Report unresolved fields, similar-review candidates, source status, and safety limitations clearly.

## Safety boundaries

- Treat the Skill and CLI as browser-read-only. They have no `Save for later` or other browser-write command.
- Never automate Mark complete, Submit, Delete, Withdraw, Release, or author approval.
- Never request, print, store, or commit passwords, session payloads, tokens, `.env`, browser profiles, clipboard queues, caches, locks, or audit files.
- Keep network access fail-closed. Do not send protocol-derived text until the confirmation hash is returned.
- Keep protocol and output files inside configured allowlisted roots.
- Do not claim that PROSPERO registration content is peer reviewed or endorsed.
- Do not invoke `prospero_apply_registration_patch`, even if MCP `full` exposes it. Stop at reviewed manual-paste assistance.

## Output expectations

Return structured evidence: query and filters, CRD/PMID identifiers, source URLs, matched and missing concepts, candidate registration fields, provenance, confidence, validation findings, and human decisions still required. Preserve machine-readable error codes and suggested recovery actions.
