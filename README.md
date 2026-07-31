# prospero-mcp

MCP server, machine-readable CLI, and installable agent skill for querying PROSPERO registered protocols and preparing guarded registration drafts.

## Non-negotiable safety boundary

> **The `prospero` CLI and `$prospero-research` Skill deliberately do not provide Submit, Mark complete, Delete, Withdraw, Release, author-approval, or browser-writing capabilities.** They stop at public discovery, evidence extraction, draft generation, validation, read-only inspection, and reviewed manual-paste assistance.

This boundary is defined by execution surface:

| Surface | May read PROSPERO | May prepare local drafts | May write into the PROSPERO browser | May submit or change record lifecycle |
| --- | ---: | ---: | ---: | ---: |
| `prospero` CLI | Yes | Yes | **No** | **No** |
| `$prospero-research` Skill | Yes, through MCP/CLI | Yes | **No direct write capability** | **No** |
| MCP `core` profile | Yes | Yes | **No** | **No** |
| MCP `authoring` profile (default) | Yes | Yes | **No** | **No** |
| MCP `full` profile | Yes | Yes | Only the separately guarded `Save for later` tool, disabled by default | **No** |

Permanent prohibitions apply to every profile and cannot be enabled by an environment variable, confirmation hash, Skill instruction, or agent request:

- No `Submit` or final registration submission.
- No `Mark complete` or section-completion action.
- No `Delete`, `Withdraw`, or `Release` action.
- No author invitation, author approval, ownership change, or declaration on a person's behalf.
- No password collection, CAPTCHA handling, or authentication bypass.

The only browser-writing exception anywhere in the codebase is the MCP `full`-profile `prospero_apply_registration_patch` tool. It can only use `Save for later`; it is unavailable from the CLI, excluded from the default MCP profile, disabled unless `PROSPERO_ENABLE_WRITES=true`, and additionally requires an exact single-use dry-run receipt, confirmation hash, field allowlist, unchanged draft state, per-draft lock, and sanitized audit record. See [docs/SAFETY_MODEL.md](docs/SAFETY_MODEL.md).

## Quick start

**Requirements:** Node.js 20+ and Chrome or Edge (used for authenticated PROSPERO pages).

### Step 1 — Install (one command)

Install straight from GitHub. It builds automatically on install, so no separate build step is needed:

```powershell
npm install -g github:erichuang777777/PROSPERO-MCP
```

This installs five global executables: `prospero`, `prospero-mcp`, `prospero-mcp-setup`, `prospero-mcp-login` and `prospero-mcp-install-skill`. Pin a specific release with `github:erichuang777777/PROSPERO-MCP#v0.2.2`.

<details>
<summary>Alternative: install from a cloned checkout</summary>

```powershell
npm install
npm run build
```

</details>

### Step 2 — First-time setup (once)

```powershell
prospero-mcp-setup
```

The guided setup finds Chrome/Edge, opens PROSPERO for website login (never asks for your password in the terminal), verifies public and authenticated access, and writes a ready-to-copy MCP config to `.prospero-mcp.generated.json`. See [FIRST_RUN.md](FIRST_RUN.md) for the full flow. Public search works without login; login is only needed for draft/schema/My-PROSPERO features.

### Step 3 — Connect your agent

This one install works for **both** Codex and Claude Code — pick your agent below.

#### Codex

1. Install the skill (installs for both agents by default; add `--codex` to limit to Codex):

   ```powershell
   prospero-mcp-install-skill
   ```

2. Add the MCP server to `~/.codex/config.toml`:

   ```toml
   [mcp_servers.prospero]
   command = "prospero-mcp"

   [mcp_servers.prospero.env]
   PROSPERO_TOOL_PROFILE = "authoring"
   PROSPERO_ALLOWED_PROTOCOL_DIRS = "D:/research"
   PROSPERO_ALLOWED_OUTPUT_DIRS = "D:/research"
   ```

   (The `.prospero-mcp.generated.json` from Step 2 lists the same command and the full set of safe env defaults you can copy over.)

3. Restart Codex and run `$prospero-research` or call `prospero_health`.

#### Claude Code

Install the bundled plugin — it wires the **MCP server and skill in one step**:

```
/plugin marketplace add erichuang777777/PROSPERO-MCP
/plugin install prospero-research@prospero-mcp
```

Then restart Claude Code and call `prospero_health`. The plugin runs the globally installed `prospero-mcp` bin, so keep Step 1 in place. Prefer manual wiring? Run `claude mcp add prospero -- prospero-mcp`, or copy the `.prospero-mcp.generated.json` entry into your MCP settings.

> The skill installer and plugin refuse to overwrite an existing skill unless `--force` is supplied. Restart the agent after installing.

### Entry points

All three surfaces share the same safety model:

- `prospero-mcp` — stdio MCP server for agent tool calls.
- `prospero` — JSON CLI for terminal agents, scripts and CI.
- `prospero-research` — installable agent skill that teaches an agent when and how to use the MCP/CLI safely.

## CLI

```powershell
prospero health
prospero search "breast cancer" --status Ongoing --year 2025,2026 --type Clinical
prospero get CRD420251181863
prospero protocol D:/research/protocol.docx --output D:/research/workbook.md
prospero protocol D:/research/protocol.docx --search
prospero protocol D:/research/protocol.docx --search --confirm <confirmation_hash>
prospero validate D:/research/answers.json --complete
prospero template --output D:/research/protocol-template.md
prospero list-drafts
prospero schema --record-version-id <uuid> --details
```

Successful operations emit `{ "ok": true, "data": ... }`. Failures emit a structured error on stderr with a stable nonzero exit code. The CLI intentionally exposes no registration submission or browser-write command, including `Save for later`.

## Tools

Public discovery:

- `prospero_health`
- `prospero_search_protocols`
- `prospero_get_protocol`
- `prospero_similar_reviews`
- `prospero_build_query`
- `prospero_bulk_export`
- `prospero_compare_similar_reviews`

Authenticated read-only registration support:

- `prospero_record_workflow`
- `prospero_list_drafts`
- `prospero_get_registration_schema`

Preparation and validation:

- `prospero_generate_workbook`
- `prospero_protocol_to_registration` — protocol → workbook → PROSPERO + optional PubMed similar-review report
- `prospero_validate_registration`
- `prospero_prepare_registration_patch`
- `prospero_analyze_protocol` — provenance, field states, confidence and missing-information interview
- `prospero_validate_search_strategy`
- `prospero_compare_protocol_versions`
- `prospero_generate_local_preview`
- `prospero_monitor_similar_reviews`
- `prospero_protect_local_artifact` / `prospero_read_protected_artifact`

Human-confirmed clipboard assistance:

- `prospero_prepare_clipboard_queue`
- `prospero_copy_confirmed_field` — copies one confirmed non-declaration field once; never touches the browser

Disabled-by-default write assistance:

- `prospero_apply_registration_patch` — saves explicitly approved fields with `Save for later` only.

`prospero_record_workflow` supports four modes:

- `view_record` — fetch and parse the full public PROSPERO record page by accession number.
- `myprospero` — open the signed-in dashboard page and report whether login is required.
- `start_registration` — open the registration coversheet page and report whether login is required.
- `register_checklist` — open the register page and extract the checklist sections when a logged-in session is available.

## Environment

- `PROSPERO_TOOL_PROFILE` - `core`, `authoring` (default), or `full`; smaller profiles publish fewer MCP tools
- `PROSPERO_RESPONSE_MODE` - `summary`, `standard` (default), or `full`; controls large response fields and truncation
- `PROSPERO_BASE_URL` - defaults to `https://www.crd.york.ac.uk/PROSPERO/api/`
- `PROSPERO_ACCESS_TOKEN` - optional; defaults to empty string
- `PROSPERO_AUTH_TOKEN` - optional; defaults to a timestamp-based token per request
- `PROSPERO_TIMEOUT_MS` - defaults to `10000`
- `PROSPERO_BROWSER_PATH` - optional; path to Chrome/Edge for page scraping
- `CHROME_PATH` / `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` - fallback browser locations
- `PROSPERO_USER_DATA_DIR` - optional; persistent Chrome/Edge profile used for PROSPERO login
- `PROSPERO_ENABLE_WRITES` - must equal `true` before guarded Save-for-later assistance can run; defaults to disabled
- `PROSPERO_AUDIT_DIR` - optional local directory for sanitized write audit records
- `PROSPERO_PATCH_DIR` - optional local directory for single-use dry-run receipts
- `PROSPERO_NETWORK_MODE` - `online` or `offline`; offline fails closed before any PROSPERO/PubMed/browser request
- `PROSPERO_ALLOWED_PROTOCOL_DIRS` - trusted input roots; defaults to the server working directory
- `PROSPERO_ALLOWED_OUTPUT_DIRS` - trusted output roots; defaults to the server working directory
- `PROSPERO_CLIPBOARD_DIR` - local single-use clipboard queue receipts
- `PROSPERO_ENABLE_CLIPBOARD` - must equal `true` before a reviewed field can be copied; defaults to disabled
- `PROSPERO_CLIPBOARD_CLEAR_MS` - clears unchanged copied text after 60 seconds by default
- `PROSPERO_CACHE_DIR` / `PROSPERO_CACHE_TTL_MS` - ignored local cache for public PROSPERO/PubMed metadata; default TTL is 6 hours and stale entries are usable only offline
- `PROSPERO_PARSER_TIMEOUT_MS` / `PROSPERO_PARSER_MAX_OLD_SPACE_MB` - isolated PDF/DOCX parser limits; defaults are 60 seconds and 256 MB
- `PROSPERO_MAX_EXTRACTED_CHARACTERS` / `PROSPERO_MAX_PDF_PAGES` - extraction ceilings; defaults are 2,000,000 characters and 1,000 PDF pages
- `PROSPERO_LOCK_DIR` - per-draft locks that prevent concurrent Save-for-later operations
- `PROSPERO_ARTIFACT_KEY` - non-Windows AES key for optional protected artifacts; Windows uses current-user DPAPI
- `PUBMED_ENABLED` - defaults to `true`; set `false` for PROSPERO-only operation
- `PUBMED_TIMEOUT_MS` - defaults to `15000`
- `NCBI_EUTILS_BASE_URL` - defaults to the official HTTPS E-utilities endpoint
- `NCBI_API_KEY` - optional; PubMed works without it at NCBI's lower public rate limit
- `NCBI_TOOL` / `NCBI_EMAIL` - optional NCBI client identification; tool defaults to `prospero-mcp`

## Login bootstrap

Run:

```bash
npm run login:prospero
```

This opens a browser on the PROSPERO login page using a dedicated local profile directory. Log in and the browser will close automatically after PROSPERO's `sessionStorage` login state is captured. The state is stored in `.prospero-profile/prospero-session.json` and restored for later `myprospero`, `register`, and `reviewcoversheet` access. On Windows the session payload is protected with current-user DPAPI. The entire profile directory is ignored by Git; do not share it.

For a complete first-time setup with checks and a generated MCP configuration, prefer:

```powershell
npm run setup:prospero
```

## Registration workbook

`PROSPERO_REGISTRATION_WORKBOOK.md` mirrors the 12 registration sections and 39 fields. It is intended for drafting and confirming answers outside PROSPERO before manually pasting them into the website. The MCP does not automatically submit registrations.

For a new review, start with the blank English [`templates/PROSPERO_PROTOCOL_TEMPLATE.md`](templates/PROSPERO_PROTOCOL_TEMPLATE.md). Its headings are machine-aligned with all 39 registration fields. The Chinese [`docs/PROSPERO_PROTOCOL_WRITING_GUIDE.md`](docs/PROSPERO_PROTOCOL_WRITING_GUIDE.md) explains what to write, current required/word constraints, automation confidence, common errors, similar-review wording and final quality checks.

`prospero_generate_workbook` can extract candidate content from TXT, Markdown, PDF and DOCX protocols. Extracted content is a draft and must be reviewed before use.

For the complete workflow, call `prospero_protocol_to_registration`. It generates the workbook first and returns the exact planned PROSPERO/PubMed queries plus a confirmation hash without sending them. Return `external_query_confirmation_hash` on the second call to authorize public-database searching. PubMed is optional: disabled access, no results, timeout, rate limiting or service failure produces a source status instead of failing the workbook or PROSPERO results. An NCBI API key is not required for low-rate use. See the [NCBI E-utilities documentation](https://www.ncbi.nlm.nih.gov/books/NBK25497/) and [NCBI disclaimer](https://www.ncbi.nlm.nih.gov/About/disclaimer/).

Example with a local protocol:

```json
{
  "protocol_path": "D:/research/protocol.docx",
  "include_pubmed": true,
  "max_prospero": 25,
  "max_pubmed": 25,
  "write_workbook": true
}
```

Use `"include_pubmed": false` or `PUBMED_ENABLED=false` for PROSPERO-only discovery. Set `PROSPERO_NETWORK_MODE=offline` for a fully local run that blocks PROSPERO, PubMed and browser access.

## Safe automation workflow

1. `prospero_analyze_protocol` produces source quotes/page or line locations, confidence, `missing/extracted/generated/needs_confirmation/confirmed/stale/blocked` states and only the unresolved interview questions.
2. `prospero_validate_search_strategy` and consistency checks detect method conflicts without inventing corrections.
3. `prospero_protocol_to_registration` previews outbound queries; the reviewed hash is required before protocol-derived terms leave the machine.
4. `prospero_generate_local_preview` creates an escaped local HTML review page.
5. `prospero_prepare_clipboard_queue` accepts only explicitly confirmed non-declaration fields; copying is opt-in, single-use, hash-audited and auto-cleared.
6. `prospero_compare_protocol_versions` and `prospero_monitor_similar_reviews` identify stale confirmations, method changes and new candidate reviews.

Protocol and output paths are resolved through real paths and must remain inside configured roots. Outbound queries are blocked if they appear to contain email addresses, phone numbers, tokens or clinical identifiers.

Protected artifacts also use two steps: the first read returns metadata and a SHA-256 confirmation hash; plaintext is released only when that exact hash is returned. PDF and DOCX extraction runs in a bounded child process. Public search caching never stores login state or protocol text.

## Write safety

CLI, Skill, MCP `core`, and the default MCP `authoring` profile are read-only with respect to the PROSPERO browser. They generate local drafts and support manual paste but cannot save browser fields.

The MCP `full` profile contains one separately guarded exception. When explicitly enabled, it requires a selected draft, a local single-use dry-run receipt and confirmation hash, the tested field-route allowlist, unchanged draft timestamp, unchanged old values, and a per-draft lock. It can only click `Save for later` and creates a sanitized audit record.

Automation for Mark complete, Submit, Delete, Withdraw, Release and author approval is intentionally unsupported. See [docs/SAFETY_MODEL.md](docs/SAFETY_MODEL.md).

## Release safety

Authentication profiles, sessions, environment files, logs, downloaded PDFs/ZIPs, and generated local configuration are excluded from Git. The npm package uses an explicit public-file allowlist.

Before publishing, run:

```powershell
npm run release:check
```

The release build omits TypeScript declarations and source maps; the development build retains them for local debugging.

Review [SECURITY.md](SECURITY.md) for the exact local credential path and release checklist.

Development contracts and roadmap are in [docs/TOOL_CONTRACTS.md](docs/TOOL_CONTRACTS.md) and [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md).

## Example

Search by keyword:

```json
{
  "query": "covid",
  "page": 1,
  "page_size": 20
}
```

Search by exact accession:

```json
{
  "accession_number": "CRD420251016642"
}
```

Fetch a public record page:

```json
{
  "mode": "view_record",
  "accession_number": "CRD420251007996"
}
```

Open the registration flow:

```json
{
  "mode": "start_registration"
}
```

Extract the registration checklist:

```json
{
  "mode": "register_checklist"
}
```
