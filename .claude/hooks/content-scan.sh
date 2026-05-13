#!/usr/bin/env bash
# KGFCM content guard. Scans content (on stdin) for forbidden patterns.
# Called by .claude/hooks/edit-write-guard.sh (PreToolUse) and by .githooks/pre-commit.
#
# Usage: content-scan.sh <file_path>   # reads content from stdin
# Exits 2 with stderr-rendered violations when blocking. 0 when clean.

set -u

FILE_PATH="${1:-stdin}"

# Self-exempt: don't scan the hooks themselves, the memory directory, or
# governance docs (which legitimately describe these forbidden patterns).
case "$FILE_PATH" in
  */.claude/hooks/*)   exit 0 ;;
  */.githooks/*)       exit 0 ;;
  */memory/*)          exit 0 ;;
  */CLAUDE.md)         exit 0 ;;
  */MEMORY.md)         exit 0 ;;
  */PROJECT_STATE.md)  exit 0 ;;
  */REFORMATION_ROADMAP.md) exit 0 ;;
  */claude-code-frequent-mistakes.md) exit 0 ;;
  */governance-boundaries.md) exit 0 ;;
  */GUIDE-bishop-admin.md) exit 0 ;;
esac

CONTENT=$(cat)
violations=()

# ── 1. btoa() result assigned to a security-sensitive name ──
if grep -qE '(pin_hash|password_hash|pwd_hash|token|secret|api_key|reset_code|auth_hash|credential|nonce|otp)[[:space:]]*[:=][[:space:]]*btoa\(' <<<"$CONTENT"; then
  violations+=("btoa() assigned to a security-sensitive name (pin_hash/token/secret/...) — base64 is NOT a hash. Use Argon2/bcrypt via a server-side edge function. See memory/feedback_no_demo_grade_code.md.")
fi

# ── 2. btoa() called on a security-sensitive value ──
if grep -qE 'btoa\([[:space:]]*(pin|password|secret|reset|otp|token)\b' <<<"$CONTENT"; then
  violations+=("btoa() called on a security-sensitive value — base64 is reversible. Use a real KDF server-side. See memory/feedback_no_demo_grade_code.md.")
fi

# ── 3. console.* anywhere in code ──
if grep -qE 'console\.(log|error|warn|debug|info)[[:space:]]*\(' <<<"$CONTENT"; then
  violations+=("console.log/error/warn/debug/info is forbidden in this codebase — route every error/event through audit() to rf_audit_log. See memory/feedback_audit_logger_only.md.")
fi

# ── 4. Math.random() in security-adjacent files OR with security keywords nearby ──
if grep -qE 'Math\.random\(' <<<"$CONTENT"; then
  case "$FILE_PATH" in
    *auth*|*token*|*reset*|*pin*|*invite*|*otp*|*credential*|*session*|*supabase/functions/*)
      violations+=("Math.random() in a security-adjacent file ($FILE_PATH) — use crypto.getRandomValues() or crypto.randomUUID(). See memory/feedback_no_demo_grade_code.md.")
      ;;
    *)
      if grep -qE '(reset|token|secret|nonce|invite|otp|verify|challenge|code|pin|auth|key|password|hash)[^=]{0,40}=[^=]{0,40}Math\.random\(|Math\.random\([^)]{0,40}(reset|token|secret|nonce|invite|otp|verify|challenge|code|pin|auth|key|password|hash)' <<<"$CONTENT"; then
        violations+=("Math.random() near a security-context word (reset/token/code/pin/...) — use crypto.getRandomValues() or crypto.randomUUID(). See memory/feedback_no_demo_grade_code.md.")
      fi
      ;;
  esac
fi

# ── 5. MVP-frame / deferred-fix comments ──
if grep -qniE '(for this mvp|for now,|we can refactor later|in production this would|we can improve later|we will fix later|todo:?[[:space:]]*(hash|real auth|implement properly|fix later|fix this|finish|migrate)|//[[:space:]]*hack|//[[:space:]]*fix later|//[[:space:]]*temporary)' <<<"$CONTENT"; then
  violations+=("Deferred-fix / 'MVP/for now' phrasing detected — KGFCM is production. No 'we can do it later' comments shipped to main. STOP AND ASK if the real work needs design. See memory/feedback_no_demo_grade_code.md.")
fi

# ── 6. CORS wildcard ──
if grep -qE '"Access-Control-Allow-Origin"[[:space:]]*:[[:space:]]*"\*"|Access-Control-Allow-Origin'\''[^'\'']*\*[^'\'']*'\''|Access-Control-Allow-Origin:[[:space:]]*\*' <<<"$CONTENT"; then
  violations+=("Access-Control-Allow-Origin: '*' is forbidden — lock CORS to the production origin. Per CLAUDE.md 'No CORS wildcards'.")
fi

# ── 7. SQL — open anon RLS policies (check per-statement, not file-wide) ──
case "$FILE_PATH" in
  *.sql)
    # Split content into ; delimited statements and inspect each in isolation.
    # A statement is a violation only if it BOTH targets anon AND has using(true)/with check(true).
    flat=$(echo "$CONTENT" | tr '\n' ' ')
    while IFS= read -r stmt; do
      [ -z "$stmt" ] && continue
      if echo "$stmt" | grep -qiE 'to[[:space:]]+anon' && \
         echo "$stmt" | grep -qiE '(using|with[[:space:]]+check)[[:space:]]*\([[:space:]]*true[[:space:]]*\)'; then
        violations+=("RLS policy statement grants anon with using(true)/with check(true) — anon access must be conditioned on JWT claims. See memory/feedback_no_demo_grade_code.md.")
        break
      fi
    done < <(echo "$flat" | tr ';' '\n')
    ;;
esac

# ── 8. Embedded --no-verify-jwt in scripts / docs ──
if grep -qE 'supabase[[:space:]]+functions[[:space:]]+deploy[^;]*--no-verify-jwt' <<<"$CONTENT"; then
  violations+=("Deploying an edge function with --no-verify-jwt is forbidden — every function must verify auth.")
fi

if [ ${#violations[@]} -eq 0 ]; then
  exit 0
fi

{
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "  KGFCM CONTENT GUARD — BLOCKED"
  echo "  File: $FILE_PATH"
  echo "═══════════════════════════════════════════════════════════════"
  for v in "${violations[@]}"; do
    echo "  • $v"
    echo ""
  done
  echo "Per CLAUDE.md: production pastoral network handling confessional data."
  echo "No shortcuts. If the real implementation requires server-side work that"
  echo "can't be inlined, STOP and surface it instead of writing a stand-in."
  echo "═══════════════════════════════════════════════════════════════"
} >&2

exit 2
