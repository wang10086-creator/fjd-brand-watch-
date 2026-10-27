# Maintenance backup recovery

Production 8d9c3e9 deployed successfully. Its first admin backup GET returned 502 with an unexpectedly closed upstream connection; the gateway logged startup again shortly afterwards. This establishes an interrupted request/restart, not a proven OOM diagnosis. No complete backup or v3 cutover has been accepted.

The backup now authenticates compressed vault bytes then streams JSON tokens, selecting all top-level history-prefixed sections. Unrelated state histories and media are not materialized. The existing pinned stream-json dependency is reused. Full input syntax is consumed and checked; selected output is capped at 32 MiB, decompressed input at 2 GiB, duration at 45 seconds. Exceeding limits fails the entire export, never claims a partial export complete. No credentials, permissions, production switches, notifications or business records change.

Regression covers exact nested values, Unicode/escaping/null/booleans, large unrelated state, input/output limits and truncated JSON, plus existing authenticated route/redaction tests. Real backup acceptance must be repeated once after deployment; do not loop failed requests against the previous version. Snapshot remains non-atomic, non-replayable, and does not include Feishu records.
