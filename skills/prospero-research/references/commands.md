# MCP and CLI command reference

## Prefer MCP

- Discovery: `prospero_search_protocols`, `prospero_get_protocol`, `prospero_similar_reviews`, `prospero_build_query`, `prospero_bulk_export`, `prospero_compare_similar_reviews`.
- Protocol authoring: `prospero_analyze_protocol`, `prospero_protocol_to_registration`, `prospero_generate_workbook`, `prospero_validate_registration`.
- Authenticated read-only inspection: `prospero_list_drafts`, `prospero_get_registration_schema`, `prospero_record_workflow`.
- Safe review helpers: `prospero_validate_search_strategy`, `prospero_compare_protocol_versions`, `prospero_generate_local_preview`, `prospero_monitor_similar_reviews`.
- Local protection: `prospero_protect_local_artifact`, `prospero_read_protected_artifact`.

Use `PROSPERO_TOOL_PROFILE=core`, `authoring`, or `full`. Use `PROSPERO_RESPONSE_MODE=summary`, `standard`, or `full`.

## CLI fallback

```text
prospero health
prospero search "breast cancer" --status Ongoing --year 2025,2026 --type Clinical
prospero get CRD420251181863
prospero similar --title "Review title" --question "Review question" --condition "Condition"
prospero protocol D:/research/protocol.docx --output D:/research/workbook.md
prospero protocol D:/research/protocol.docx --search
prospero protocol D:/research/protocol.docx --search --confirm <confirmation_hash>
prospero validate D:/research/answers.json --complete
prospero template --output D:/research/protocol-template.md
prospero list-drafts
prospero schema --record-version-id <uuid> --details
```

Successful commands emit `{ "ok": true, "data": ... }`. Errors go to stderr as `{ "ok": false, "error": { "code", "message", "retryable", "action" } }` and use nonzero exit codes. `prospero help` prints the command list.

## Setup

Use `prospero-mcp-setup` for guided first-run configuration and `prospero-mcp-login` for browser login capture. Login occurs on the PROSPERO website; never collect the password in the terminal or agent conversation.
