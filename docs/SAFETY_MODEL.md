# Registration automation safety model

## Boundary definition

The CLI and Skill never write to the PROSPERO browser. MCP `core` and default `authoring` profiles also expose no browser-write tool. Only MCP `full` may expose the disabled-by-default guarded `Save for later` operation described below.

The following actions are permanently unsupported on every surface: Submit, Mark complete, Delete, Withdraw, Release, author invitation/approval, ownership change, declarations on another person's behalf, password collection, CAPTCHA handling, and authentication bypass. No configuration option, Skill instruction, or confirmation receipt enables these actions.

## Capability levels

### Level 0: public read

Search public records, retrieve public details and export results. No login required.

### Level 1: authenticated read

List the signed-in user's drafts, inspect a selected draft and capture registration fields. No website data is changed.

### Level 2: preparation

Generate workbook answers, validation findings, similar-review comparisons and a proposed patch. No website data is changed.

Protocol-derived external queries require a preview hash before network transmission. Offline mode blocks all browser, PROSPERO API and PubMed API access.

### Level 3: guarded save

Enter only explicitly approved fields and click only `Save for later`. This level is disabled by default and requires all runtime guards.

## Permanent prohibitions

The implementation must not provide or invoke automation for:

- Mark as complete
- Submit for publication
- Author approval
- Delete record or version
- Withdraw or discontinue a record
- Release a version
- Change account credentials

## Required write guards

1. `PROSPERO_ENABLE_WRITES=true`.
2. Exact draft identifier.
3. Explicit list of allowed field routes.
4. Dry-run patch hash supplied back as confirmation.
5. A matching local receipt exists and has not previously been consumed.
6. Every key, title and route matches the tested 39-field allowlist.
7. Current value still matches the value observed during dry-run.
8. Browser is on the expected field route.
9. Only the `Save for later` button may be clicked.
10. The receipt is consumed only after a successful save and sanitized audit entry.
11. Sanitized audit output contains no answer text, session token or password.

## Data classification

- Secret: session token, complete browser profile, passwords.
- Personal: user/account details, team emails and ORCIDs.
- Research-confidential: unpublished protocol and draft registration answers.
- Public: published PROSPERO records and explicitly released documentation.

Secrets are never returned by MCP tools. Personal and research-confidential data are returned only when required for the requested local workflow.

## Local and outbound guards

- Protocol and output paths must remain within explicit real-path allowlists; symlink escape is rejected.
- Outbound queries are scanned for email, phone, token and clinical-identifier patterns.
- Protocol-derived searches use a two-step query preview and confirmation hash.
- Local previews HTML-escape all answers.
- Clipboard queues accept only confirmed non-declaration fields and each item is single use.
- Optional protected artifacts use Windows current-user DPAPI or AES-256-GCM with a local non-Windows key.
- Similar-review snapshots contain public identifiers and source status, not protocol answers.
