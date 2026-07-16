# Security and local data

## Authentication model

PROSPERO stores authenticated state in browser `sessionStorage`. The guided login captures only the resulting session token and user session object after successful website login. It does not collect or store the PROSPERO password.

Local authentication data is stored under:

```text
.prospero-profile/
  prospero-session.json
```

Treat the entire profile directory as a credential. Do not share, upload, commit, attach to issues, or include it in release files.

An optional `NCBI_API_KEY` is also a secret. Store it only in a local environment variable or ignored `.env` file. The MCP health tool reports only whether it is configured and never returns its value.

`PROSPERO_ARTIFACT_KEY` is a secret on non-Windows systems and must follow the same rule. On Windows, protected research artifacts use DPAPI bound to the current Windows user.

On Windows, the saved session payload is encrypted with DPAPI for the current Windows user. On other platforms it is protected by restrictive file permissions; the profile directory must still be treated as a credential.

Guarded write audit records are stored in `.prospero-audit/` by default. They contain field names and hashes of old/new values, not the answer text or session token.

Dry-run receipts are stored in `.prospero-patches/` by default. They contain draft identifiers, field keys and confirmation metadata, never answer text. A receipt is local and single use.

## Files excluded from Git and releases

- `.prospero-profile/`
- `.env` and `.env.*` except the empty `.env.example`
- `*.log`
- generated MCP configuration
- downloaded ZIP, PDF and TGZ files
- generated registration-field captures
- `.prospero-audit/`
- `.prospero-patches/`
- `.prospero-clipboard/`
- `.prospero-cache/`
- `.prospero-locks/`

Clipboard access is disabled unless `PROSPERO_ENABLE_CLIPBOARD=true`; copied values are never written to the clipboard audit log and are cleared after the configured interval if unchanged. Protected artifact reads require a separate plaintext-release confirmation hash. Public caches contain only public PROSPERO/PubMed responses, never protocol text, credentials, or browser state.

The npm package also uses an explicit `files` allowlist. Only compiled code and public documentation can enter `npm pack` output.

## Before publishing

Run:

```powershell
npm run release:check
```

Inspect the printed tarball file list. It must not contain `.prospero-profile`, `prospero-session.json`, email addresses, log files, `.env`, PDFs, or ZIP files.

PubMed metadata and abstracts are retrieved through NCBI E-utilities. Users remain responsible for complying with the [NCBI disclaimer and copyright notice](https://www.ncbi.nlm.nih.gov/About/disclaimer/); the tool returns short indexed metadata for similarity review and does not download article full text.

If authentication data is accidentally disclosed, terminate the PROSPERO session by logging out, re-authenticate, remove the disclosed artifact, and rotate the account password if there is any possibility that credentials were exposed.
