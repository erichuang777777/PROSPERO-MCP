# prospero-mcp

MCP server for querying PROSPERO registered protocols.

## Quick start

```powershell
npm install
npm run build
npm run setup:prospero
```

The guided setup finds Chrome/Edge, opens PROSPERO for website login, verifies public and authenticated access, and generates a local MCP configuration example. See [FIRST_RUN.md](FIRST_RUN.md) for the complete first-time flow.

Released packages also provide `prospero-mcp-setup` and `prospero-mcp-login` executables.

## Tools

- `prospero_health`
- `prospero_search_protocols`
- `prospero_get_protocol`
- `prospero_similar_reviews`
- `prospero_record_workflow`

`prospero_record_workflow` supports four modes:

- `view_record` — fetch and parse the full public PROSPERO record page by accession number.
- `myprospero` — open the signed-in dashboard page and report whether login is required.
- `start_registration` — open the registration coversheet page and report whether login is required.
- `register_checklist` — open the register page and extract the checklist sections when a logged-in session is available.

## Environment

- `PROSPERO_BASE_URL` - defaults to `https://www.crd.york.ac.uk/PROSPERO/api/`
- `PROSPERO_ACCESS_TOKEN` - optional; defaults to empty string
- `PROSPERO_AUTH_TOKEN` - optional; defaults to a timestamp-based token per request
- `PROSPERO_TIMEOUT_MS` - defaults to `10000`
- `PROSPERO_BROWSER_PATH` - optional; path to Chrome/Edge for page scraping
- `CHROME_PATH` / `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` - fallback browser locations
- `PROSPERO_USER_DATA_DIR` - optional; persistent Chrome/Edge profile used for PROSPERO login

## Login bootstrap

Run:

```bash
npm run login:prospero
```

This opens a browser on the PROSPERO login page using a dedicated local profile directory. Log in and the browser will close automatically after PROSPERO's `sessionStorage` login state is captured. The state is stored in `.prospero-profile/prospero-session.json` and restored for later `myprospero`, `register`, and `reviewcoversheet` access. The entire profile directory is ignored by Git; do not share it.

For a complete first-time setup with checks and a generated MCP configuration, prefer:

```powershell
npm run setup:prospero
```

## Registration workbook

`PROSPERO_REGISTRATION_WORKBOOK.md` mirrors the 12 registration sections and 39 fields. It is intended for drafting and confirming answers outside PROSPERO before manually pasting them into the website. The MCP does not automatically submit registrations.

## Release safety

Authentication profiles, sessions, environment files, logs, downloaded PDFs/ZIPs, and generated local configuration are excluded from Git. The npm package uses an explicit public-file allowlist.

Before publishing, run:

```powershell
npm run release:check
```

Review [SECURITY.md](SECURITY.md) for the exact local credential path and release checklist.

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
