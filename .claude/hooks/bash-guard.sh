#!/usr/bin/env bash
# PreToolUse Bash guard — hard-blocks forbidden shell operations.
set -u

INPUT=$(cat)
CMD=$(jq -r '.tool_input.command // ""' <<<"$INPUT")

# Strip HEREDOC bodies, single-quoted, and double-quoted string literals
# before matching. Commit messages and docs that reference the forbidden
# patterns as TEXT must not trip the guard — only actual command words do.
STRIPPED=$(printf '%s' "$CMD" | \
  perl -0777 -pe "s/<<'([A-Z_]+)'.*?\\n\\1//gs" 2>/dev/null | \
  perl -0777 -pe "s/'[^']*'//gs"           2>/dev/null | \
  perl -0777 -pe 's/"(?:\\.|[^"\\])*"//gs' 2>/dev/null)
[ -z "$STRIPPED" ] && STRIPPED="$CMD"
CMD="$STRIPPED"

violations=()

# --no-verify-jwt on supabase functions deploy
if grep -qE 'supabase[[:space:]]+functions[[:space:]]+deploy[^;]*--no-verify-jwt' <<<"$CMD"; then
  violations+=("supabase functions deploy --no-verify-jwt is forbidden — every edge function must verify auth.")
fi

# --no-verify on git commit / push / merge
if grep -qE 'git[[:space:]]+(commit|push|merge|rebase)[^;]*--no-verify' <<<"$CMD"; then
  violations+=("git --no-verify is forbidden — fix the failing hook, do not skip it (CLAUDE.md rule 13).")
fi

# git push --force / -f
if grep -qE 'git[[:space:]]+push[^;]*(--force([[:space:]]|$)|--force-with-lease|[[:space:]]-f([[:space:]]|$))' <<<"$CMD"; then
  violations+=("git push --force is forbidden without explicit user authorization (CLAUDE.md rule 14).")
fi

# git add . / -A / --all (broad staging that can sweep in secrets)
if grep -qE 'git[[:space:]]+add[[:space:]]+(\.|--all|-A)([[:space:]]|;|&&|\||$)' <<<"$CMD"; then
  violations+=("git add . / -A / --all is forbidden — stage specific files by name (CLAUDE.md rule 11).")
fi

# Destructive git operations
if grep -qE 'git[[:space:]]+reset[[:space:]]+--hard|git[[:space:]]+clean[[:space:]]+-f|git[[:space:]]+checkout[[:space:]]+\.|git[[:space:]]+restore[[:space:]]+\.|git[[:space:]]+branch[[:space:]]+-D' <<<"$CMD"; then
  violations+=("Destructive git operation without explicit user authorization (CLAUDE.md rule 14).")
fi

# Bypassing commit signing
if grep -qE -- '(--no-gpg-sign|commit\.gpgsign=false)' <<<"$CMD"; then
  violations+=("Bypassing commit signing is forbidden.")
fi

if [ ${#violations[@]} -eq 0 ]; then
  exit 0
fi

{
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "  KGFCM BASH GUARD — BLOCKED"
  echo "  Command: $CMD"
  echo "═══════════════════════════════════════════════════════════════"
  for v in "${violations[@]}"; do
    echo "  • $v"
  done
  echo "═══════════════════════════════════════════════════════════════"
} >&2

exit 2
