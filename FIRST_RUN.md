# First-time setup

This guide keeps PROSPERO credentials inside a dedicated local browser profile. The MCP server never asks for your password in the terminal and never stores it in the repository.

## 1. Requirements

- Node.js 20 or newer
- Google Chrome or Microsoft Edge
- A PROSPERO account

Check Node.js:

```powershell
node --version
```

## 2. Install and build

From a source checkout:

```powershell
npm install
npm run build
```

If installed from a released npm package, the guided executable is `prospero-mcp-setup` and no source build is required.

Optionally install the bundled Codex skill:

```powershell
prospero-mcp-install-skill
```

Restart Codex so it discovers `$prospero-research`. MCP and CLI work without the skill; the skill adds agent routing, workflows, and safety instructions.

## 3. Run guided setup

```powershell
npm run setup:prospero
```

Installed-package equivalent:

```powershell
prospero-mcp-setup
```

The guide will:

1. Check Node.js and find Chrome or Edge.
2. Open a dedicated browser window.
3. Ask you to log in on the PROSPERO website itself.
4. Capture the resulting browser session locally.
5. verify public search and an authenticated PROSPERO page.
6. Generate `.prospero-mcp.generated.json` with an MCP client configuration example.

The browser closes automatically after login is captured. Do not type your PROSPERO password into the terminal or any configuration file.

## 4. Add the MCP server

Open `.prospero-mcp.generated.json`, copy the `prospero` entry into your MCP client's `mcpServers` configuration, and restart the client.

The generated configuration uses absolute paths so the login profile is found even when the MCP client starts from another working directory.

It also restricts protocol reads and generated-file writes to the directory where setup was run. To use a separate research directory, edit the generated MCP environment and set both paths explicitly:

```json
{
  "PROSPERO_ALLOWED_PROTOCOL_DIRS": "D:/research",
  "PROSPERO_ALLOWED_OUTPUT_DIRS": "D:/research"
}
```

Use semicolons between multiple roots on Windows. `PROSPERO_NETWORK_MODE=offline` provides a fully local drafting mode.

## 5. Verify from the MCP client

Call these tools in order:

1. `prospero_health`
2. `prospero_search_protocols` with `{"query":"breast cancer","page_size":5}`
3. `prospero_record_workflow` with `{"mode":"myprospero"}`

You can also verify the setup from the terminal:

```powershell
npm run setup:check
```

Installed-package equivalent:

```powershell
prospero-mcp-setup --check-only
```

## 6. Re-authenticate

If PROSPERO rejects or expires the saved session:

```powershell
npm run login:prospero
```

Installed-package equivalent:

```powershell
prospero-mcp-login
```

The new session replaces the local saved session. It does not modify source files.

## 7. Prepare registration answers

Use `PROSPERO_REGISTRATION_WORKBOOK.md` outside the website. Draft and confirm each answer there, then paste fields into PROSPERO manually. This project does not automatically submit a registration.

For protocol-assisted drafting, call `prospero_generate_workbook` with a local TXT, Markdown, PDF or DOCX file, then call `prospero_validate_registration` before copying answers to PROSPERO. Always confirm dates, review stage, team details, conflicts and methodological commitments yourself.

`prospero_protocol_to_registration` adds similar-review discovery. It always produces the protocol workbook even if PubMed is disabled or temporarily unavailable. PubMed does not require an API key for low-rate use; an optional key can be kept in the local `NCBI_API_KEY` environment variable and must never be committed.
