# Changelog

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
