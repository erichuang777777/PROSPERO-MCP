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
