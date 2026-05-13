#!/usr/bin/env bash
# PreToolUse Edit/Write wrapper. Extracts the new content from the tool input
# and pipes it into content-scan.sh, which decides whether to block.
set -u

INPUT=$(cat)
TOOL=$(jq -r '.tool_name // ""' <<<"$INPUT")
FILE_PATH=$(jq -r '.tool_input.file_path // ""' <<<"$INPUT")
SCANNER="$(dirname "$0")/content-scan.sh"

case "$TOOL" in
  Write)
    jq -r '.tool_input.content // ""' <<<"$INPUT" | "$SCANNER" "$FILE_PATH"
    ;;
  Edit)
    jq -r '.tool_input.new_string // ""' <<<"$INPUT" | "$SCANNER" "$FILE_PATH"
    ;;
  *)
    exit 0
    ;;
esac
