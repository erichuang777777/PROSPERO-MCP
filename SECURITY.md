# Security and local data

## Authentication model

PROSPERO stores authenticated state in browser `sessionStorage`. The guided login captures only the resulting session token and user session object after successful website login. It does not collect or store the PROSPERO password.

Local authentication data is stored under:

```text
.prospero-profile/
  prospero-session.json
```

Treat the entire profile directory as a credential. Do not share, upload, commit, attach to issues, or include it in release files.

## Files excluded from Git and releases

- `.prospero-profile/`
- `.env` and `.env.*` except the empty `.env.example`
- `*.log`
- generated MCP configuration
- downloaded ZIP, PDF and TGZ files
- generated registration-field captures

The npm package also uses an explicit `files` allowlist. Only compiled code and public documentation can enter `npm pack` output.

## Before publishing

Run:

```powershell
npm run release:check
```

Inspect the printed tarball file list. It must not contain `.prospero-profile`, `prospero-session.json`, email addresses, log files, `.env`, PDFs, or ZIP files.

If authentication data is accidentally disclosed, terminate the PROSPERO session by logging out, re-authenticate, remove the disclosed artifact, and rotate the account password if there is any possibility that credentials were exposed.
